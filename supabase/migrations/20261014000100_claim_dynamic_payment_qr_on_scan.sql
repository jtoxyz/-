-- 動的支払いQRを「読み取られた瞬間」に次のQRへ切り替える。
-- これまでは支払い確定（redeem_payment_qr）まで同じQRが表示され続け、
-- 読み取った人がログインしている間は次の人が読み取れなかった。
--
-- 1. 学生が QR を開くと（ログイン前でも）claim_payment_qr が QR を「読み取り済み」にし、次の QR を発行する。
-- 2. 管理画面は読み取り済みでない QR だけを表示する（admin_get_current_dynamic_payment_qr）。
-- 3. 読み取り済みの QR は、読み取りから 10 分以内なら redeem_payment_qr で支払い確定できる。

begin;

alter table public.payment_qr_codes
  add column if not exists claimed_at timestamptz;

-- QR を開いた時点で呼ぶ。ログイン不要（anon 可）。トークンを知っている端末だけが呼べる。
-- 戻り値 status: 'claimed'（今回読み取り済みにした）/ 'already_claimed'（受付時間内の読み取り済み QR）/ 'daily'（1日QR）
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
     set claimed_at = now()
   where q.token = p_token
     and q.mode = 'dynamic'
     and q.is_active
     and q.claimed_at is null
     and q.valid_from <= now()
     and q.valid_until > now()
  returning q.* into v_qr;

  if found then
    insert into public.payment_qr_codes(
      event_id, mode, token, valid_date, valid_from, valid_until, is_active, created_by
    ) values (
      v_qr.event_id, 'dynamic', encode(gen_random_bytes(24), 'hex'), null, now(), 'infinity'::timestamptz, true, v_qr.created_by
    );
    select e.title into v_title from public.events e where e.id = v_qr.event_id;
    return query select 'claimed'::text, v_title;
    return;
  end if;

  select * into v_qr
    from public.payment_qr_codes q
   where q.token = p_token
     and q.is_active
     and q.valid_from <= now()
     and q.valid_until > now()
     and (q.mode = 'daily' or q.claimed_at > now() - interval '10 minutes');

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

  -- 動的QRは条件付きUPDATEで先に取得する。
  -- 同じQRへの同時アクセスでも、このUPDATEに成功するのは一件だけ。
  -- 読み取り済み（claimed_at あり）の QR は、読み取りから 10 分以内だけ使える。
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
     and (q.claimed_at is null or q.claimed_at > now() - interval '10 minutes')
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
    -- 例外により動的QRの無効化もロールバックされる。
    raise exception '支払い待ちの予約が見つかりません。';
  end if;

  if v_qr.mode = 'daily' then
    update public.payment_qr_codes
       set redemption_count = redemption_count + 1,
           last_redeemed_at = now()
     where id = v_qr.id;
  elsif v_qr.claimed_at is null then
    -- 読み取り時に次のQRを発行していない場合（claim を経由しない古い画面など）だけ、ここで発行する。
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

-- 管理画面には、まだ誰も読み取っていない QR だけを出す
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
     and q.claimed_at is null
   order by q.created_at desc
   limit 1;
end $$;

revoke all on function public.admin_get_current_dynamic_payment_qr(uuid) from public, anon;
grant execute on function public.admin_get_current_dynamic_payment_qr(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
