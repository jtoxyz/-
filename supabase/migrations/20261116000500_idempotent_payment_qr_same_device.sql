-- 動的支払いQR：同じ端末の画面が二重に動いたときに「使用済み」と出さない（2026-11-16）
--
-- 本番ログで、同じ端末・同じログインから claim / redeem が同時に2回ずつ届き、
-- 片方は成功、もう片方が「使用済み」エラーになっていた（支払い自体は成功しているのにエラーが見える恐れ）。
--
-- これから：読み取り時と同じ鍵（p_claim_key）を持つ端末が、確定済み（10分以内）のQRをもう一度確認・確定した場合は、
--   エラーにせず最初の確定と同じ結果を返す。予約は二重に更新しない。
--   鍵が違う端末・鍵なしの呼び出し・別の学生は、これまでどおりエラーになる。
-- 引数・戻り値は変更なし。

begin;

create or replace function public.claim_payment_qr(p_token text, p_claim_key text)
returns table(status text, event_title text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_qr public.payment_qr_codes%rowtype;
  v_title text;
  v_hash text;
begin
  if p_claim_key is not null and char_length(p_claim_key) not between 16 and 128 then
    raise exception '読み取り情報が不正です。もう一度QRコードを読み取ってください。';
  end if;
  v_hash := case when p_claim_key is null then null else encode(digest(p_claim_key, 'sha256'), 'hex') end;

  -- 同時に開かれても、読み取り済みにできるのは一件だけ（行ロック後に条件を再確認するため）
  update public.payment_qr_codes q
     set claimed_at = now(),
         claim_key_hash = v_hash,
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
    -- 共有の QR（lane なし）は次の QR をここで発行する。端末専用 QR は画面の次回取得時に発行される。
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
    -- 同じ端末がすでに支払い確定まで済ませたQR（画面が二重に動いたとき）。確定側が同じ結果を返すので先へ進める
    if v_hash is not null then
      select * into v_qr
        from public.payment_qr_codes q
       where q.token = p_token
         and q.mode = 'dynamic'
         and q.consumed_at > now() - interval '10 minutes'
         and q.claim_key_hash = v_hash;
      if found then
        select e.title into v_title from public.events e where e.id = v_qr.event_id;
        return query select 'already_claimed'::text, v_title;
        return;
      end if;
    end if;
    raise exception 'このQRコードは使用済み、無効、または期限切れです。画面に表示されている新しいQRコードを読み取ってください。';
  end if;

  -- 別の端末が先に読み取った動的QR
  if v_qr.mode = 'dynamic' and v_qr.claim_key_hash is not null and v_qr.claim_key_hash is distinct from v_hash then
    raise exception 'このQRコードはほかの人が先に読み取りました。画面に表示されている新しいQRコードを読み取ってください。';
  end if;

  select e.title into v_title from public.events e where e.id = v_qr.event_id;
  return query select case when v_qr.mode = 'daily' then 'daily' else 'already_claimed' end, v_title;
end $$;

revoke all on function public.claim_payment_qr(text, text) from public;
grant execute on function public.claim_payment_qr(text, text) to anon, authenticated;

create or replace function public.redeem_payment_qr(p_token text, p_claim_key text)
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
  v_hash text;
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

  v_hash := case when p_claim_key is null then null else encode(digest(p_claim_key, 'sha256'), 'hex') end;

  -- 動的QRは条件付きUPDATEで先に取得する。同時アクセスでも成功するのは一件だけ。
  -- 表示中（未読み取り）の QR、または読み取りから10分以内で未使用の QR を受け付ける。
  -- 鍵付きで読み取られた QR は、同じ鍵を持つ端末だけが確定できる。
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
       or (
         q.claimed_at > now() - interval '10 minutes'
         and (q.claim_key_hash is null or q.claim_key_hash = v_hash)
       )
     )
  returning q.* into v_qr;

  if not found then
    -- 鍵が合わない読み取り済みQR
    if exists (
      select 1 from public.payment_qr_codes q
       where q.token = p_token
         and q.mode = 'dynamic'
         and q.consumed_at is null
         and q.claimed_at > now() - interval '10 minutes'
         and q.claim_key_hash is not null
         and q.claim_key_hash is distinct from v_hash
    ) then
      raise exception 'このQRコードはほかの人が先に読み取りました。画面に表示されている新しいQRコードを読み取ってください。';
    end if;

    -- 同じ端末・同じ学生がこのQRですでに確定済み（画面が二重に動いたとき）。二重に処理せず、同じ結果を返す。
    -- 確定時は consumed_at と paid_at に同じ now() が入るので、その一致でこのQRによる支払いだけを数える。
    if v_hash is not null then
      select * into v_qr
        from public.payment_qr_codes q
       where q.token = p_token
         and q.mode = 'dynamic'
         and q.consumed_at > now() - interval '10 minutes'
         and q.claim_key_hash = v_hash;
      if found then
        select count(*) into v_count
          from public.reservations r
         where r.event_id = v_qr.event_id
           and lower(r.university_email) = v_email
           and r.payment_status = 'paid'
           and r.paid_at = v_qr.consumed_at;
        if v_count > 0 then
          select e.title into v_title from public.events e where e.id = v_qr.event_id;
          return query select v_qr.event_id, v_title, v_count, v_qr.mode;
          return;
        end if;
      end if;
    end if;

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

revoke all on function public.redeem_payment_qr(text, text) from public, anon;
grant execute on function public.redeem_payment_qr(text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
