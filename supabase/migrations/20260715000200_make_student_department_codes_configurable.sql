create table if not exists public.student_number_settings (
  id boolean primary key default true check (id),
  allowed_department_codes text[] not null,
  updated_at timestamptz not null default now(),
  updated_by uuid null
);

insert into public.student_number_settings (id, allowed_department_codes)
values (true, array['P','T','B','C','E','H','M','S','V','F','G','K','L'])
on conflict (id) do nothing;

alter table public.student_number_settings enable row level security;
revoke all on public.student_number_settings from anon, authenticated;

drop function if exists public.get_allowed_student_department_codes();
create function public.get_allowed_student_department_codes()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select allowed_department_codes
  from public.student_number_settings
  where id = true;
$$;

revoke all on function public.get_allowed_student_department_codes() from public;
grant execute on function public.get_allowed_student_department_codes() to anon, authenticated;

drop function if exists public.update_allowed_student_department_codes(text[]);
create function public.update_allowed_student_department_codes(p_codes text[])
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codes text[];
begin
  if auth.uid() is null or not exists (
    select 1 from public.admin_users where id = auth.uid()
  ) then
    raise exception '管理者権限が必要です。';
  end if;

  select array_agg(code order by code)
  into v_codes
  from (
    select distinct upper(trim(code)) as code
    from unnest(coalesce(p_codes, array[]::text[])) as code
    where upper(trim(code)) ~ '^[A-Z]$'
  ) normalized;

  if coalesce(array_length(v_codes, 1), 0) = 0 then
    raise exception '学科コードを1つ以上登録してください。';
  end if;

  insert into public.student_number_settings (id, allowed_department_codes, updated_at, updated_by)
  values (true, v_codes, now(), auth.uid())
  on conflict (id) do update
  set allowed_department_codes = excluded.allowed_department_codes,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;

  return v_codes;
end;
$$;

revoke all on function public.update_allowed_student_department_codes(text[]) from public;
grant execute on function public.update_allowed_student_department_codes(text[]) to authenticated;

alter table public.reservations drop constraint if exists reservations_student_number_official_format_check;

create or replace function public.validate_reservation_student_number()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_number text;
  v_year integer;
  v_serial integer;
  v_current_academic_year integer;
  v_code text;
  v_allowed_codes text[];
begin
  v_number := upper(trim(new.student_number));

  if v_number !~ '^[0-9]{2}[A-Z][0-9]{3}$' then
    raise exception '学籍番号は数字2桁＋英字1文字＋数字3桁で入力してください。';
  end if;

  v_code := substring(v_number from 3 for 1);
  select allowed_department_codes into v_allowed_codes
  from public.student_number_settings
  where id = true;

  if v_allowed_codes is null or not (v_code = any(v_allowed_codes)) then
    raise exception '登録されていない学科コードです。管理者に確認してください。';
  end if;

  v_year := substring(v_number from 1 for 2)::integer;
  v_serial := substring(v_number from 4 for 3)::integer;
  v_current_academic_year := case
    when extract(month from timezone('Asia/Tokyo', now())) >= 4
      then extract(year from timezone('Asia/Tokyo', now()))::integer % 100
    else (extract(year from timezone('Asia/Tokyo', now()))::integer - 1) % 100
  end;

  if v_year > v_current_academic_year then
    raise exception '未来の入学年度は使用できません。';
  end if;

  if v_serial = 0 then
    raise exception '学籍番号の末尾000は使用できません。';
  end if;

  new.student_number := v_number;
  return new;
end;
$$;
