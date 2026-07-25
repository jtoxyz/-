alter table public.payment_qr_codes
  add column if not exists consumed_at timestamptz,
  add column if not exists replaced_by uuid references public.payment_qr_codes(id) on delete set null;

create unique index if not exists payment_qr_one_active_dynamic_per_event
  on public.payment_qr_codes(event_id)
  where mode = 'dynamic' and is_active;

create or replace function public.admin_create_payment_qr(
  p_event_id uuid,
  p_mode text,
  p_valid_date date default null,
  p_dynamic_seconds integer default 90
)
returns table(
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
  v_from := now();

  if p_mode = 'daily' then
    v_date := coalesce(p_valid_date, (now() at time zone 'Asia/Tokyo')::date);
    v_from := (v_date::timestamp at time zone 'Asia/Tokyo');
    v_until := ((v_date + 1)::timestamp at time zone 'Asia/Tokyo');

    update public.payment_qr_codes
       set is_active = false
     where event_id = p_event_id
       and mode = 'daily'
       and valid_date = v_date
       and is_active;
  else
    -- 動的QRは時間更新ではなく、一回使用されるまで有効。
    v_date := null;
    v_until := 'infinity'::timestamptz;

    update public.payment_qr_codes
       set is_active = false
     where event_id = p_event_id
       and mode = 'dynamic'
       and is_active;
  end if;

  insert into public.payment_qr_codes(event_id, mode, token, valid_date, valid_from, valid_until, created_by)
  values (p_event_id, p_mode, v_token, v_date, v_from, v_until, auth.uid())
  returning id into v_id;

  return query select v_id, v_token, p_mode, v_from, v_until;
end;
$$;

create or replace function public.redeem_payment_qr(p_token text)
returns table(event_id uuid, event_title text, paid_reservations integer, qr_mode text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_qr public.payment_qr_codes%rowtype;
  v_email text;
  v_count integer;
  v_title text;
  v_next_id uuid;
  v_next_token text;
begin
  if auth.uid() is null then
    raise exception '大学Googleアカウントでログインしてください。';
  end if;

  select lower(email) into v_email
    from auth.users
   where id = auth.uid();

  if v_email is null or v_email !~ '^s[0-9]{2}[a-z][0-9]{3}@ge\.osaka-sandai\.ac\.jp$' then
    raise exception '大学メールアカウントを確認できません。';
  end if;

  update public.payment_qr_codes q
     set is_active = false,
         consumed_at = now(),
         redemption_count = q.redemption_count + 1,
         last_redeemed_at = now()
   where q.token = p_token
     and q.mode = 'dynamic'
     and q.is_active
     and q.valid_from <= now()
     and q.valid_until > now()
  returning q.* into v_qr;

  if not found then
    select * into v_qr
      from public.payment_qr_codes q
     where q.token = p_token
       and q.mode = 'daily'
       and q.is_active
       and q.valid_from <= now()
       and q.valid_until > now();

    if not found then
      raise exception 'このQRコードは使用済み、無効、または期限切れです。';
    end if;
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

  if v_qr.mode = 'daily' then
    update public.payment_qr_codes
       set redemption_count = redemption_count + 1,
           last_redeemed_at = now()
     where id = v_qr.id;
  else
    v_next_token := encode(gen_random_bytes(24), 'hex');
    insert into public.payment_qr_codes(
      event_id, mode, token, valid_date, valid_from, valid_until, is_active, created_by
    ) values (
      v_qr.event_id, 'dynamic', v_next_token, null, now(), 'infinity'::timestamptz, true, v_qr.created_by
    ) returning id into v_next_id;

    update public.payment_qr_codes
       set replaced_by = v_next_id
     where id = v_qr.id;
  end if;

  select e.title into v_title
    from public.events e
   where e.id = v_qr.event_id;

  return query select v_qr.event_id, v_title, v_count, v_qr.mode;
end;
$$;

create or replace function public.admin_get_current_dynamic_payment_qr(p_event_id uuid)
returns table(qr_id uuid, qr_token text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.admin_users au where au.user_id = auth.uid()) then
    raise exception '管理者権限が必要です。';
  end if;

  return query
  select q.id, q.token, q.created_at
    from public.payment_qr_codes q
   where q.event_id = p_event_id
     and q.mode = 'dynamic'
     and q.is_active
   order by q.created_at desc
   limit 1;
end;
$$;

grant execute on function public.admin_get_current_dynamic_payment_qr(uuid) to authenticated;
revoke execute on function public.admin_get_current_dynamic_payment_qr(uuid) from anon;

create or replace function public.admin_list_payment_qr(p_event_id uuid)
returns table(
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
         (q.is_active and (q.mode = 'dynamic' or q.valid_until > now())),
         q.redemption_count, q.created_at
    from public.payment_qr_codes q
   where q.event_id = p_event_id
   order by q.created_at desc
   limit 50;
end;
$$;

notify pgrst, 'reload schema';
