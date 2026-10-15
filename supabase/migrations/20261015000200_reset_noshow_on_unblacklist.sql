-- ブラックリストを解除したら「支払いに来なかった回数」を0に戻す。
-- 予約データは消さず、解除した日時（user_blacklist.removed_at）より後の自動キャンセルだけを数える。
-- 解除時点の回数は user_blacklist.noshow_count_at_removal に残し、解除済みの一覧で確認できるようにする。

begin;

alter table public.user_blacklist
  add column if not exists noshow_count_at_removal integer;

-- その学生の最後のブラックリスト解除日時（学籍番号、またはその学生が使ったメールで照合）
create or replace function public.last_blacklist_removed_at(p_student_number text)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select max(b.removed_at)
    from public.user_blacklist b
   where b.removed_at is not null
     and (
       b.student_number = p_student_number
       or b.university_email in (
         select distinct r.university_email from public.reservations r where r.student_number = p_student_number
       )
     );
$$;

revoke all on function public.last_blacklist_removed_at(text) from public, anon, authenticated;

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
     and r.payment_status = 'expired'
     and coalesce(r.cancelled_at, r.payment_due_at)
         > coalesce(public.last_blacklist_removed_at(p_student_number), '-infinity'::timestamptz);
$$;

revoke all on function public.count_payment_noshows(text) from public, anon, authenticated;

-- 解除の直前に、その時点の回数を記録する（この行の removed_at はまだ反映前なので、リセット前の回数になる）
create or replace function public.record_noshow_count_on_unblacklist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student text;
begin
  if old.active is true and new.active is false then
    v_student := coalesce(
      new.student_number,
      (select r.student_number from public.reservations r
        where r.university_email = new.university_email
        order by r.created_at desc limit 1)
    );
    new.noshow_count_at_removal := case when v_student is null then null else public.count_payment_noshows(v_student) end;
  end if;
  return new;
end $$;

revoke all on function public.record_noshow_count_on_unblacklist() from public, anon, authenticated;

create or replace trigger user_blacklist_record_noshow_reset
  before update of active on public.user_blacklist
  for each row
  execute function public.record_noshow_count_on_unblacklist();

-- 管理者向け一覧：2回以上（リセット後の回数）の人
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
      and coalesce(r.cancelled_at, r.payment_due_at)
          > coalesce(public.last_blacklist_removed_at(r.student_number), '-infinity'::timestamptz)
    group by r.student_number
    having count(*) >= 2
  ) x
  left join public.user_profiles p on p.student_number = x.student_number
  order by x.n desc, x.last_at desc;
end $$;

revoke all on function public.admin_list_noshow_users() from public, anon;
grant execute on function public.admin_list_noshow_users() to authenticated;

notify pgrst, 'reload schema';
commit;
