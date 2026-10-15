-- 支払いに来なかった予約（支払期限切れで自動キャンセルされた予約）の回数に応じた利用制限。
-- ・回数は全企画・全期間で学籍番号ごとに数える（status = 'cancelled' かつ payment_status = 'expired'）。
--   管理画面で「未払いに戻す」などにより expired だけになった予約（status はそのまま）は数えない。
-- ・2回でイエローリスト：予約サイトに警告を表示する（get_my_noshow_status）。
-- ・3回でブラックリスト：3回目の自動キャンセルの時点で user_blacklist に自動登録する。

begin;

create index if not exists idx_reservations_noshow_student
  on public.reservations(student_number)
  where status = 'cancelled' and payment_status = 'expired';

create or replace function public.count_payment_noshows(p_student_number text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.reservations r
   where r.student_number = p_student_number
     and r.status = 'cancelled'
     and r.payment_status = 'expired';
$$;

revoke all on function public.count_payment_noshows(text) from public, anon, authenticated;

create or replace function public.auto_blacklist_payment_noshow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.count_payment_noshows(new.student_number) >= 3
     and not public.is_user_blacklisted(new.student_number, new.university_email) then
    insert into public.user_blacklist(student_number, university_email, reason, active)
    values (new.student_number, new.university_email, '支払いに3回来なかったため（自動登録）', true);
  end if;
  return new;
end $$;

revoke all on function public.auto_blacklist_payment_noshow() from public, anon, authenticated;

create or replace trigger reservations_auto_blacklist_noshow
  after update of status, payment_status on public.reservations
  for each row
  when (
    new.status = 'cancelled' and new.payment_status = 'expired'
    and (old.status is distinct from 'cancelled' or old.payment_status is distinct from 'expired')
  )
  execute function public.auto_blacklist_payment_noshow();

-- 学生向け：自分の「来なかった回数」と制限の段階
create or replace function public.get_my_noshow_status()
returns table(noshow_count integer, level text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile public.user_profiles%rowtype;
  v_count integer;
begin
  if auth.uid() is null then
    return;
  end if;
  select * into v_profile from public.user_profiles where user_id = auth.uid();
  if not found then
    return;
  end if;

  v_count := public.count_payment_noshows(v_profile.student_number);
  return query select
    v_count,
    case
      when public.is_user_blacklisted(v_profile.student_number, v_profile.university_email) then 'blacklisted'
      when v_count >= 2 then 'yellow'
      else 'normal'
    end;
end $$;

revoke all on function public.get_my_noshow_status() from public, anon;
grant execute on function public.get_my_noshow_status() to authenticated;

-- 管理者向け：2回以上来なかった人の一覧（イエローリストと自動ブラックリスト対象）
create or replace function public.admin_list_noshow_users()
returns table(
  student_number text,
  student_name text,
  university_email text,
  noshow_count integer,
  last_noshow_at timestamptz,
  is_blacklisted boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.admin_users au where au.user_id = auth.uid()) then
    raise exception '管理者権限が必要です。';
  end if;

  return query
  select
    x.student_number,
    coalesce(p.student_name, x.latest_name),
    coalesce(p.university_email, x.latest_email),
    x.n::integer,
    x.last_at,
    public.is_user_blacklisted(x.student_number, coalesce(p.university_email, x.latest_email))
  from (
    select
      r.student_number,
      count(*) as n,
      max(coalesce(r.cancelled_at, r.payment_due_at)) as last_at,
      (array_agg(r.student_name order by r.created_at desc))[1] as latest_name,
      (array_agg(r.university_email order by r.created_at desc))[1] as latest_email
    from public.reservations r
    where r.status = 'cancelled' and r.payment_status = 'expired'
    group by r.student_number
    having count(*) >= 2
  ) x
  left join public.user_profiles p on p.student_number = x.student_number
  order by x.n desc, x.last_at desc;
end $$;

revoke all on function public.admin_list_noshow_users() from public, anon;
grant execute on function public.admin_list_noshow_users() to authenticated;

-- 導入時点で3回以上の人がいればブラックリストに登録する（冪等）
insert into public.user_blacklist(student_number, university_email, reason, active)
select x.student_number, x.email, '支払いに3回来なかったため（自動登録）', true
from (
  select r.student_number, (array_agg(r.university_email order by r.created_at desc))[1] as email
  from public.reservations r
  where r.status = 'cancelled' and r.payment_status = 'expired'
  group by r.student_number
  having count(*) >= 3
) x
where not public.is_user_blacklisted(x.student_number, x.email);

notify pgrst, 'reload schema';
commit;
