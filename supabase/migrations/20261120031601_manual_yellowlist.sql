-- イエローリストに管理者が手動で登録できるようにする。
-- ・これまでのイエローリストは「支払いに2回来なかった人」を予約履歴から自動で数えたものだけだった。
-- ・手動登録は別テーブル user_yellowlist に保存し、ブラックリスト（user_blacklist / is_user_blacklisted）の判定には影響させない。
-- ・手動でイエローリストに登録中の人が支払いに来なかった場合は、その時点でブラックリストに自動登録する
--   （「次に来なかったら利用できなくなる」という自動イエローリストと同じ扱い）。
-- ・get_my_access_status は互換のため既存の列をそのまま返し、yellow_reason / yellow_expires_at を末尾に追加する。

begin;

create table if not exists public.user_yellowlist (
  id uuid primary key default gen_random_uuid(),
  student_number text,
  university_email text,
  reason text not null,
  active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid,
  constraint user_yellowlist_identifier_required
    check (student_number is not null or university_email is not null)
);

create unique index if not exists user_yellowlist_active_student_number_uidx
  on public.user_yellowlist(student_number)
  where active and student_number is not null;

create unique index if not exists user_yellowlist_active_email_uidx
  on public.user_yellowlist(university_email)
  where active and university_email is not null;

alter table public.user_yellowlist enable row level security;

revoke all on table public.user_yellowlist from anon;

drop policy if exists user_yellowlist_admin_select on public.user_yellowlist;
create policy user_yellowlist_admin_select on public.user_yellowlist
  for select to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

drop policy if exists user_yellowlist_admin_insert on public.user_yellowlist;
create policy user_yellowlist_admin_insert on public.user_yellowlist
  for insert to authenticated
  with check (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

drop policy if exists user_yellowlist_admin_update on public.user_yellowlist;
create policy user_yellowlist_admin_update on public.user_yellowlist
  for update to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())))
  with check (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

drop policy if exists user_yellowlist_admin_delete on public.user_yellowlist;
create policy user_yellowlist_admin_delete on public.user_yellowlist
  for delete to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

-- 学籍番号・メールの正規化、登録者・解除日時の記録はブラックリストと同じ関数を使う
drop trigger if exists user_yellowlist_normalize on public.user_yellowlist;
create trigger user_yellowlist_normalize
  before insert or update on public.user_yellowlist
  for each row execute function public.normalize_blacklist_entry();

create or replace function public.audit_yellowlist_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
  v_id uuid;
  v_details jsonb;
begin
  if tg_op = 'INSERT' then
    v_action := 'yellowlist_add';
    v_id := new.id;
    v_details := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_action := case
      when old.active is true and new.active is false then 'yellowlist_remove'
      when old.active is false and new.active is true then 'yellowlist_restore'
      else 'yellowlist_update'
    end;
    v_id := new.id;
    v_details := jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new));
  else
    v_action := 'yellowlist_delete';
    v_id := old.id;
    v_details := to_jsonb(old);
  end if;

  insert into public.admin_action_logs(action, target_table, target_id, details, actor_user_id)
  values (v_action, 'user_yellowlist', v_id::text, v_details, auth.uid());

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.audit_yellowlist_change() from public, anon, authenticated;

drop trigger if exists user_yellowlist_audit on public.user_yellowlist;
create trigger user_yellowlist_audit
  after insert or update or delete on public.user_yellowlist
  for each row execute function public.audit_yellowlist_change();

create or replace function public.is_user_yellowlisted(
  p_student_number text,
  p_university_email text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_student text;
  v_email text;
begin
  v_student := upper(regexp_replace(btrim(coalesce(p_student_number, '')), '\s+', '', 'g'));
  if v_student like 'S%' then
    v_student := substr(v_student, 2);
  end if;
  v_email := lower(btrim(coalesce(p_university_email, '')));

  return exists (
    select 1
      from public.user_yellowlist y
     where y.active
       and (y.expires_at is null or y.expires_at > now())
       and (
         (v_student <> '' and y.student_number = v_student)
         or (v_email <> '' and y.university_email = v_email)
       )
  );
end;
$$;

revoke all on function public.is_user_yellowlisted(text, text) from public, anon, authenticated;

-- 支払いに来なかったとき：3回目、または手動イエローリスト登録中ならブラックリストへ
create or replace function public.auto_blacklist_payment_noshow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_user_blacklisted(new.student_number, new.university_email) then
    return new;
  end if;

  if public.count_payment_noshows(new.student_number) >= 3 then
    insert into public.user_blacklist(student_number, university_email, reason, active)
    values (new.student_number, new.university_email, '支払いに3回来なかったため（自動登録）', true);
  elsif public.is_user_yellowlisted(new.student_number, new.university_email) then
    insert into public.user_blacklist(student_number, university_email, reason, active)
    values (new.student_number, new.university_email, 'イエローリスト登録中に支払いに来なかったため（自動登録）', true);
  end if;
  return new;
end $$;

revoke all on function public.auto_blacklist_payment_noshow() from public, anon, authenticated;

-- 戻り値の列を追加するため作り直す（既存の列名・順序はそのまま）
drop function if exists public.get_my_access_status();

create function public.get_my_access_status()
returns table(
  noshow_count integer,
  level text,
  blacklist_reason text,
  blacklist_expires_at timestamptz,
  yellow_reason text,
  yellow_expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_profile public.user_profiles%rowtype;
  v_student text;
  v_email text;
  v_count integer;
  v_reason text;
  v_expires timestamptz;
  v_blacklisted boolean;
  v_yellow_reason text;
  v_yellow_expires timestamptz;
  v_yellowlisted boolean;
begin
  if auth.uid() is null then
    return;
  end if;

  select * into v_profile from public.user_profiles where user_id = auth.uid();
  if not found then
    return;
  end if;

  v_student := upper(regexp_replace(btrim(coalesce(v_profile.student_number, '')), '\s+', '', 'g'));
  if v_student like 'S%' then
    v_student := substr(v_student, 2);
  end if;
  v_email := lower(btrim(coalesce(v_profile.university_email, '')));

  v_count := public.count_payment_noshows(v_profile.student_number);

  select b.reason, b.expires_at
    into v_reason, v_expires
    from public.user_blacklist b
   where b.active
     and (b.expires_at is null or b.expires_at > now())
     and (
       (v_student <> '' and b.student_number = v_student)
       or (v_email <> '' and b.university_email = v_email)
     )
   order by b.created_at desc
   limit 1;
  v_blacklisted := found;

  select y.reason, y.expires_at
    into v_yellow_reason, v_yellow_expires
    from public.user_yellowlist y
   where y.active
     and (y.expires_at is null or y.expires_at > now())
     and (
       (v_student <> '' and y.student_number = v_student)
       or (v_email <> '' and y.university_email = v_email)
     )
   order by y.created_at desc
   limit 1;
  v_yellowlisted := found;

  return query select
    v_count,
    case
      when v_blacklisted then 'blacklisted'
      when v_yellowlisted or v_count >= 2 then 'yellow'
      else 'normal'
    end,
    case when v_blacklisted then v_reason else null end,
    case when v_blacklisted then v_expires else null end,
    case when not v_blacklisted and v_yellowlisted then v_yellow_reason else null end,
    case when not v_blacklisted and v_yellowlisted then v_yellow_expires else null end;
end
$function$;

revoke all on function public.get_my_access_status() from public;
revoke all on function public.get_my_access_status() from anon;
grant execute on function public.get_my_access_status() to authenticated;

notify pgrst, 'reload schema';
commit;
