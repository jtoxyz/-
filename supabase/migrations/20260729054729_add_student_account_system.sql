begin;

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  university_email text not null unique,
  student_number text not null unique,
  student_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name_updated_by uuid references auth.users(id) on delete set null,
  name_updated_at timestamptz,
  constraint user_profiles_student_number_format check (student_number ~ '^[0-9]{2}[A-Z][0-9]{3}$'),
  constraint user_profiles_email_format check (university_email ~ '^s[0-9]{2}[a-z][0-9]{3}@ge\.osaka-sandai\.ac\.jp$'),
  constraint user_profiles_name_length check (char_length(btrim(student_name)) between 1 and 100)
);

alter table public.reservations add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.admin_pre_registrations add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists idx_reservations_user_id on public.reservations(user_id);
create index if not exists idx_admin_pre_registrations_user_id on public.admin_pre_registrations(user_id);
create index if not exists idx_user_profiles_email_lower on public.user_profiles(lower(university_email));

alter table public.user_profiles enable row level security;
grant select on public.user_profiles to authenticated;
revoke insert,update,delete on public.user_profiles from anon,authenticated;

drop policy if exists user_profiles_select_own on public.user_profiles;
create policy user_profiles_select_own on public.user_profiles for select to authenticated
using ((select auth.uid())=user_id);

drop policy if exists user_profiles_admin_select on public.user_profiles;
create policy user_profiles_admin_select on public.user_profiles for select to authenticated
using (exists(select 1 from public.admin_users au where au.user_id=(select auth.uid())));

drop policy if exists reservations_select_own on public.reservations;
create policy reservations_select_own on public.reservations for select to authenticated
using ((select auth.uid())=user_id);

create or replace function public.create_my_profile(p_student_name text)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare
  v_uid uuid:=auth.uid();
  v_email text;
  v_student_number text;
  v_name text;
  v_profile public.user_profiles%rowtype;
begin
  if v_uid is null then raise exception '大学Googleアカウントでログインしてください。'; end if;
  select lower(u.email) into v_email from auth.users u where u.id=v_uid and u.email_confirmed_at is not null;
  if v_email is null or v_email !~ '^s[0-9]{2}[a-z][0-9]{3}@ge\.osaka-sandai\.ac\.jp$' then
    raise exception '大阪産業大学のGoogleアカウントを確認できません。';
  end if;
  if not exists(select 1 from auth.identities i where i.user_id=v_uid and i.provider='google') then
    raise exception 'Googleログインで認証してください。';
  end if;

  v_student_number:=upper(substr(split_part(v_email,'@',1),2));
  v_name:=regexp_replace(btrim(coalesce(p_student_name,'')),'[[:space:]]+',' ','g');
  if char_length(v_name)<1 or char_length(v_name)>100 then
    raise exception '氏名は1文字以上100文字以内で入力してください。';
  end if;

  select * into v_profile from public.user_profiles where user_id=v_uid;
  if not found then
    insert into public.user_profiles(user_id,university_email,student_number,student_name)
    values(v_uid,v_email,v_student_number,v_name) returning * into v_profile;
  end if;

  update public.reservations
  set user_id=v_uid,student_name=v_profile.student_name,student_number=v_profile.student_number,university_email=v_profile.university_email
  where lower(university_email)=v_profile.university_email and (user_id is null or user_id=v_uid);

  update public.admin_pre_registrations
  set user_id=v_uid,student_name=v_profile.student_name,student_number=v_profile.student_number,university_email=v_profile.university_email
  where lower(university_email)=v_profile.university_email and (user_id is null or user_id=v_uid);

  return jsonb_build_object(
    'user_id',v_profile.user_id,
    'university_email',v_profile.university_email,
    'student_number',v_profile.student_number,
    'student_name',v_profile.student_name,
    'created_at',v_profile.created_at
  );
end $$;

revoke all on function public.create_my_profile(text) from public,anon;
grant execute on function public.create_my_profile(text) to authenticated;
notify pgrst,'reload schema';
commit;
