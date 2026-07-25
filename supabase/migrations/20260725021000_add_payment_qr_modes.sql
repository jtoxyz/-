create extension if not exists pgcrypto with schema extensions;

create table if not exists public.payment_qr_codes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  mode text not null check (mode in ('daily','dynamic')),
  token text not null unique,
  valid_date date,
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_redeemed_at timestamptz,
  redemption_count integer not null default 0,
  constraint payment_qr_valid_window check (valid_until > valid_from),
  constraint payment_qr_daily_date_check check ((mode = 'daily' and valid_date is not null) or (mode = 'dynamic' and valid_date is null))
);

create index if not exists payment_qr_codes_event_mode_idx
  on public.payment_qr_codes(event_id, mode, is_active, valid_until desc);

create unique index if not exists payment_qr_codes_one_daily_per_event_date
  on public.payment_qr_codes(event_id, valid_date)
  where mode = 'daily' and is_active;

alter table public.payment_qr_codes enable row level security;

drop policy if exists payment_qr_codes_admin_select on public.payment_qr_codes;
create policy payment_qr_codes_admin_select
on public.payment_qr_codes
for select
to authenticated
using (exists (select 1 from public.admin_users au where au.user_id = auth.uid()));

revoke all on public.payment_qr_codes from anon, authenticated;
grant select on public.payment_qr_codes to authenticated;

create or replace function public.admin_create_payment_qr(
  p_event_id uuid,
  p_mode text,
  p_valid_date date default null,
  p_dynamic_seconds integer default 90
)
returns table (
  qr_id uuid,
  qr_token text,
  qr_mode text,
  valid_from timestamptz,
  valid_until timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
  v_from timestamptz;
  v_until timestamptz;
  v_date date;
  v_id uuid;
begin
  if not exists (select 1 from public.admin_users au where au.user_id = auth.uid()) then
    raise exception '管理者権限が必要です。';
  end if;
  if not exists (select 1 from public.events e where e.id = p_event_id and coalesce(e.payment_required,false)) then
    raise exception '支払い必須の企画が見つかりません。';
  end if;
  if p_mode not in ('daily','dynamic') then
    raise exception 'QRモードが不正です。';
  end if;

  v_token := encode(gen_random_bytes(24), 'hex');

  if p_mode = 'daily' then
    v_date := coalesce(p_valid_date, (now() at time zone 'Asia/Tokyo')::date);
    v_from := (v_date::timestamp at time zone 'Asia/Tokyo');
    v_until := ((v_date + 1)::timestamp at time zone 'Asia/Tokyo');

    update public.payment_qr_codes
      set is_active = false
      where event_id = p_event_id and mode = 'daily' and valid_date = v_date and is_active;
  else
    if p_dynamic_seconds < 15 or p_dynamic_seconds > 600 then
      raise exception '動的QRの有効時間は15〜600秒で指定してください。';
    end if;
    v_date := null;
    v_from := now();
    v_until := now() + make_interval(secs => p_dynamic_seconds);

    update public.payment_qr_codes
      set is_active = false
      where event_id = p_event_id and mode = 'dynamic' and is_active;
  end if;

  insert into public.payment_qr_codes(event_id, mode, token, valid_date, valid_from, valid_until, created_by)
  values (p_event_id, p_mode, v_token, v_date, v_from, v_until, auth.uid())
  returning id into v_id;

  return query select v_id, v_token, p_mode, v_from, v_until;
end;
$$;

revoke all on function public.admin_create_payment_qr(uuid,text,date,integer) from public, anon;
grant execute on function public.admin_create_payment_qr(uuid,text,date,integer) to authenticated;

create or replace function public.admin_list_payment_qr(p_event_id uuid)
returns table (
  qr_id uuid,
  qr_token text,
  qr_mode text,
  valid_date date,
  valid_from timestamptz,
  valid_until timestamptz,
  is_active boolean,
  redemption_count integer,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.admin_users au where au.user_id = auth.uid()) then
    raise exception '管理者権限が必要です。';
  end if;
  return query
    select q.id, q.token, q.mode, q.valid_date, q.valid_from, q.valid_until,
           (q.is_active and q.valid_until > now()), q.redemption_count, q.created_at
    from public.payment_qr_codes q
    where q.event_id = p_event_id
    order by q.created_at desc
    limit 50;
end;
$$;

revoke all on function public.admin_list_payment_qr(uuid) from public, anon;
grant execute on function public.admin_list_payment_qr(uuid) to authenticated;

create or replace function public.redeem_payment_qr(p_token text)
returns table (
  event_id uuid,
  event_title text,
  paid_reservations integer,
  qr_mode text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qr public.payment_qr_codes%rowtype;
  v_email text;
  v_count integer;
  v_title text;
begin
  if auth.uid() is null then
    raise exception '大学Googleアカウントでログインしてください。';
  end if;

  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_email is null or v_email !~ '^s[0-9]{2}[a-z][0-9]{3}@ge\\.osaka-sandai\\.ac\\.jp$' then
    raise exception '大学メールアカウントを確認できません。';
  end if;

  select * into v_qr
  from public.payment_qr_codes
  where token = p_token
    and is_active
    and valid_from <= now()
    and valid_until > now()
  for update;

  if not found then
    raise exception 'このQRコードは無効または期限切れです。';
  end if;

  update public.reservations r
  set payment_status = 'paid',
      paid_at = now(),
      payment_confirmed_by = null
  where r.event_id = v_qr.event_id
    and lower(r.university_email) = v_email
    and r.status = 'reserved'
    and r.payment_status = 'pending';

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception '支払い待ちの予約が見つかりません。';
  end if;

  update public.payment_qr_codes
  set redemption_count = redemption_count + 1,
      last_redeemed_at = now()
  where id = v_qr.id;

  select title into v_title from public.events where id = v_qr.event_id;
  return query select v_qr.event_id, v_title, v_count, v_qr.mode;
end;
$$;

revoke all on function public.redeem_payment_qr(text) from public, anon;
grant execute on function public.redeem_payment_qr(text) to authenticated;

notify pgrst, 'reload schema';
