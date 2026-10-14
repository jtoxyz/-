-- 動的支払いQRを端末（lane）ごとに分ける。
-- これまでは企画ごとに表示中の動的QRが1つだけで、複数のスマホで開くと全員が同じQRを表示し、
-- 同時に読み取った学生同士で取り合いになっていた。
--
-- ・管理画面は端末ごとのランダムな lane ID を持ち、admin_get_lane_payment_qr で「その端末専用の QR」を取得する。
--   未読み取りの QR がなければその場で発行する。
-- ・端末専用 QR は is_active = false のまま扱う（企画ごとに有効な動的QRを1つに限る既存の一意制約に掛からないようにするため）。
--   表示中かどうかは lane あり・未読み取り（claimed_at なし）・未使用（consumed_at なし）で判定する。
-- ・学生が読み取ると claim_payment_qr が読み取り済みにし、その端末の次の QR は次回の取得時に発行される。
-- ・支払い確定（redeem_payment_qr）は、読み取りから10分以内なら受け付ける（従来どおり）。

begin;

alter table public.payment_qr_codes
  add column if not exists lane text;

create or replace function public.admin_get_lane_payment_qr(p_event_id uuid, p_lane text)
returns table(qr_id uuid, qr_token text, created_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_qr public.payment_qr_codes%rowtype;
begin
  if not exists (select 1 from public.admin_users au where au.user_id = auth.uid()) then
    raise exception '管理者権限が必要です。';
  end if;
  if p_lane is null or char_length(p_lane) not between 8 and 64 then
    raise exception '端末IDが不正です。';
  end if;
  if not exists (select 1 from public.events e where e.id = p_event_id and coalesce(e.payment_required, false)) then
    raise exception '支払い必須の企画が見つかりません。';
  end if;

  -- 同じ端末から同時に呼ばれても QR を二重に発行しない
  perform pg_advisory_xact_lock(hashtextextended('payment_qr_lane:' || p_event_id::text || ':' || p_lane, 0));

  select * into v_qr
    from public.payment_qr_codes q
   where q.event_id = p_event_id
     and q.mode = 'dynamic'
     and q.lane = p_lane
     and q.claimed_at is null
     and q.consumed_at is null
     and q.valid_from <= now()
     and q.valid_until > now()
   order by q.created_at desc
   limit 1;

  if not found then
    insert into public.payment_qr_codes(
      event_id, mode, token, valid_date, valid_from, valid_until, is_active, created_by, lane
    ) values (
      p_event_id, 'dynamic', encode(gen_random_bytes(24), 'hex'), null, now(), 'infinity'::timestamptz, false, auth.uid(), p_lane
    ) returning * into v_qr;
  end if;

  return query select v_qr.id, v_qr.token, v_qr.created_at;
end $$;

revoke all on function public.admin_get_lane_payment_qr(uuid, text) from public, anon;
grant execute on function public.admin_get_lane_payment_qr(uuid, text) to authenticated;

create or replace function public.claim_payment_qr(p_token text)
returns table(status text, event_title text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_qr public.payment_qr_codes%rowtype;
  v_title text;
begin
  -- 同時に開かれても、読み取り済みにできるのは一件だけ
  update public.payment_qr_codes q
     set claimed_at = now(),
         is_active = false
   where q.token = p_token
     and q.mode = 'dynamic'
     and q.claimed_at is null
     and q.consumed_at is null
     and q.valid_from <= now()
     and q.valid_until > now()
     and (q.is_active or q.lane is not null)
  returning q.* into v_qr;

  if found then
    -- 共有の QR（lane なし）は次の QR をここで発行する。端末専用 QR は管理画面の次回取得時に発行される。
    if v_qr.lane is null then
      insert into public.payment_qr_codes(
        event_id, mode, token, valid_date, valid_from, valid_until, is_active, created_by
      ) values (
        v_qr.event_id, 'dynamic', encode(gen_random_bytes(24), 'hex'), null, now(), 'infinity'::timestamptz, true, v_qr.created_by
      );
    end if;
    select e.title into v_title from public.events e where e.id = v_qr.event_id;
    return query select 'claimed'::text, v_title;
    return;
  end if;

  -- 読み取り済みで支払い確定待ちの動的QR、または有効な1日QR
  select * into v_qr
    from public.payment_qr_codes q
   where q.token = p_token
     and q.valid_from <= now()
     and q.valid_until > now()
     and (
       (q.mode = 'dynamic' and q.consumed_at is null and q.claimed_at > now() - interval '10 minutes')
       or (q.mode = 'daily' and q.is_active)
     );

  if not found then
    raise exception 'このQRコードは使用済み、無効、または期限切れです。画面に表示されている新しいQRコードを読み取ってください。';
  end if;

  select e.title into v_title from public.events e where e.id = v_qr.event_id;
  return query select case when v_qr.mode = 'daily' then 'daily' else 'already_claimed' end, v_title;
end $$;

revoke all on function public.claim_payment_qr(text) from public;
grant execute on function public.claim_payment_qr(text) to anon, authenticated;

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

  -- 動的QRは条件付きUPDATEで先に取得する。同時アクセスでも成功するのは一件だけ。
  -- 表示中（未読み取り）の QR、または読み取りから10分以内で未使用の QR を受け付ける。
  update public.payment_qr_codes q
     set is_active = false,
         consumed_at = now(),
         redemption_count = q.redemption_count + 1,
         last_redeemed_at = now()
   where q.token = p_token
     and q.mode = 'dynamic'
     and q.consumed_at is null
     and q.valid_from <= now()
     and q.valid_until > now()
     and (
       (q.claimed_at is null and (q.is_active or q.lane is not null))
       or q.claimed_at > now() - interval '10 minutes'
     )
  returning q.* into v_qr;

  if not found then
    -- 1日QRは複数人が利用できるため無効化しない。
    select * into v_qr
      from public.payment_qr_codes q
     where q.token = p_token
       and q.mode = 'daily'
       and q.is_active
       and q.valid_from <= now()
       and q.valid_until > now();

    if not found then
      raise exception 'このQRコードは使用済み、無効、または期限切れです。画面に表示されている新しいQRコードを読み取ってください。';
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
    -- 例外により動的QRの使用済み化もロールバックされる。
    raise exception '支払い待ちの予約が見つかりません。';
  end if;

  if v_qr.mode = 'daily' then
    update public.payment_qr_codes
       set redemption_count = redemption_count + 1,
           last_redeemed_at = now()
     where id = v_qr.id;
  elsif v_qr.claimed_at is null and v_qr.lane is null then
    -- 共有 QR を claim を経由せずに使った場合（古い画面など）だけ、ここで次の QR を発行する。
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
end $$;

revoke all on function public.redeem_payment_qr(text) from public, anon;
grant execute on function public.redeem_payment_qr(text) to authenticated;

notify pgrst, 'reload schema';
commit;
