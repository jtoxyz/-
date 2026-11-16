-- 動的支払いQRの「同時読み取り」対策と、端末QRの作り直し（2026-11-16）
--
-- これまで：同じQRを2人がほぼ同時に読み取ると、2人目も 'already_claimed' で先へ進めた。
--   2人ともログインまで進み、先に確定した1人だけが成功、もう1人はログイン後に「使用済み」と言われていた。
--   後から読み取った人が先に確定すれば、最初に読み取った人の分を横取りできた。
--
-- これから：
--   ・学生の端末は読み取り時にランダムな鍵（p_claim_key）を作って送る。DBはそのハッシュを QR に記録する。
--   ・同じQRを別の鍵で開いた人には、その場で「ほかの人が先に読み取りました」と返す（ログイン前に分かる）。
--   ・支払い確定（redeem_payment_qr）は、鍵が記録された QR では同じ鍵を持つ端末だけが行える。
--   ・鍵なしで読み取った QR（更新前の画面）は従来どおり扱う（互換）。
--
-- 端末QRの作り直し：staff_reissue_lane_payment_qr でこの端末の未読み取りQRを期限切れにし、新しいQRを出す。
--   管理者・担当スタッフの両方が使う（can_operate_event で確認）。

begin;

alter table public.payment_qr_codes
  add column if not exists claim_key_hash text;

comment on column public.payment_qr_codes.claim_key_hash is
  '動的QRを読み取った端末の鍵（sha256）。支払い確定はこの鍵を持つ端末だけが行える。null は鍵なしの読み取り（旧画面）';

-- 引数を増やすので古い定義を外す（同じ名前の関数を1つに保つ）。p_claim_key は省略可能なので旧画面からの呼び出しも通る。
drop function if exists public.claim_payment_qr(text);
drop function if exists public.redeem_payment_qr(text);

create or replace function public.claim_payment_qr(p_token text, p_claim_key text default null)
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

create or replace function public.redeem_payment_qr(p_token text, p_claim_key text default null)
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

-- この端末の表示中QR（未読み取り）を期限切れにして、新しいQRを出す。管理者と担当スタッフが使う。
-- 読み取り済みで支払い確定待ちのQRには触らない（ログイン中の学生の確定を妨げない）。
create or replace function public.staff_reissue_lane_payment_qr(p_event_id uuid, p_lane text)
returns table(qr_id uuid, qr_token text, created_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_qr public.payment_qr_codes%rowtype;
begin
  if not public.can_operate_event(p_event_id) then
    raise exception 'この企画を操作する権限がありません。';
  end if;
  if p_lane is null or char_length(p_lane) not between 8 and 64 then
    raise exception '端末IDが不正です。';
  end if;
  if not exists (select 1 from public.events e where e.id = p_event_id and coalesce(e.payment_required, false)) then
    raise exception '支払い必須の企画が見つかりません。';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('payment_qr_lane:' || p_event_id::text || ':' || p_lane, 0));

  update public.payment_qr_codes q
     set valid_until = now()
   where q.event_id = p_event_id
     and q.mode = 'dynamic'
     and q.lane = p_lane
     and q.claimed_at is null
     and q.consumed_at is null
     and q.valid_until > now();

  insert into public.payment_qr_codes(
    event_id, mode, token, valid_date, valid_from, valid_until, is_active, created_by, lane
  ) values (
    p_event_id, 'dynamic', encode(gen_random_bytes(24), 'hex'), null, now(), 'infinity'::timestamptz, false, auth.uid(), p_lane
  ) returning * into v_qr;

  return query select v_qr.id, v_qr.token, v_qr.created_at;
end $$;

revoke all on function public.staff_reissue_lane_payment_qr(uuid, text) from public, anon;
grant execute on function public.staff_reissue_lane_payment_qr(uuid, text) to authenticated;

notify pgrst, 'reload schema';
commit;
