-- 受付の係が支払い済みにする方式：スキーマ、記録用の内部関数、学生QR方式の拒否
-- 既存企画の動きは変えない（既定は student_scan）。

-- 1. 企画ごとの支払い確認方式
alter table public.events
  add column if not exists payment_confirm_mode text not null default 'student_scan';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.events'::regclass
       and conname = 'events_payment_confirm_mode_check'
  ) then
    alter table public.events
      add constraint events_payment_confirm_mode_check
      check (payment_confirm_mode in ('student_scan', 'staff'));
  end if;
end $$;

-- 2. 受領の記録（追記のみ。読み書きは security definer の関数だけが行う）
create table if not exists public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  action text not null check (action in ('received', 'undone')),
  amount_yen integer not null check (amount_yen >= 0),
  operator_user_id uuid references auth.users(id) on delete set null,
  operator_name text,
  -- 取り消しがどの受領を打ち消すか（照合で受け取った人の合計から引くため）
  reverses_receipt_id uuid references public.payment_receipts(id) on delete set null,
  created_at timestamptz not null default now(),
  check (action = 'undone' or reverses_receipt_id is null)
);

create index if not exists idx_payment_receipts_event_created
  on public.payment_receipts(event_id, created_at);
create index if not exists idx_payment_receipts_reservation_created
  on public.payment_receipts(reservation_id, created_at desc);
create index if not exists idx_payment_receipts_operator
  on public.payment_receipts(operator_user_id) where operator_user_id is not null;
create index if not exists idx_payment_receipts_reverses
  on public.payment_receipts(reverses_receipt_id) where reverses_receipt_id is not null;

alter table public.payment_receipts enable row level security;
revoke all on table public.payment_receipts from anon, authenticated;

-- 3. 操作した人の表示名（スタッフなら表示名、なければメール）
create or replace function public.current_operator_name()
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select nullif(s.display_name, '') from public.staff_members s where s.id = public.current_staff_id()),
    (select u.email from auth.users u where u.id = auth.uid())
  );
$function$;

revoke execute on function public.current_operator_name() from public, anon, authenticated;

-- 4. 受領・取り消しを1行記録する内部関数（他のRPCからだけ呼ぶ）
create or replace function public.log_payment_receipt(
  p_reservation_id uuid,
  p_action text,
  p_reverses_receipt_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_event_id uuid;
  v_price integer;
  v_amount integer;
  v_id uuid;
begin
  if p_action not in ('received', 'undone') then
    raise exception '記録の種類が不正です。';
  end if;

  select r.event_id, coalesce(o.price_yen, 0)
    into v_event_id, v_price
    from public.reservations r
    left join public.event_ticket_options o on o.id = r.ticket_option_id
   where r.id = p_reservation_id;

  if not found then
    raise exception '予約が見つかりません。';
  end if;

  v_amount := v_price;
  if p_action = 'undone' and p_reverses_receipt_id is not null then
    select pr.amount_yen into v_amount
      from public.payment_receipts pr
     where pr.id = p_reverses_receipt_id
       and pr.reservation_id = p_reservation_id
       and pr.action = 'received';
    if not found then
      raise exception '打ち消す受領の記録が見つかりません。';
    end if;
  elsif p_action = 'received' then
    p_reverses_receipt_id := null;
  end if;

  insert into public.payment_receipts(
    event_id, reservation_id, action, amount_yen,
    operator_user_id, operator_name, reverses_receipt_id
  ) values (
    v_event_id, p_reservation_id, p_action, v_amount,
    auth.uid(), public.current_operator_name(), p_reverses_receipt_id
  ) returning id into v_id;

  return v_id;
end $function$;

revoke execute on function public.log_payment_receipt(uuid, text, uuid) from public, anon, authenticated;

-- 5. 企画ごとの方式を取得（画面の出し分け用。ログイン済みなら誰でも）
create or replace function public.get_event_payment_confirm_modes(p_event_ids uuid[])
returns table(event_id uuid, payment_confirm_mode text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'ログインしてください。';
  end if;
  if coalesce(array_length(p_event_ids, 1), 0) > 100 then
    raise exception '一度に確認できる企画は100件までです。';
  end if;
  return query
    select e.id, e.payment_confirm_mode
      from public.events e
     where e.id = any(coalesce(p_event_ids, '{}'::uuid[]));
end $function$;

revoke execute on function public.get_event_payment_confirm_modes(uuid[]) from public, anon;
grant execute on function public.get_event_payment_confirm_modes(uuid[]) to authenticated;

-- 6. 学生QR方式の拒否（本体は本番の定義のまま、先頭に判定だけ追加）
CREATE OR REPLACE FUNCTION public.claim_payment_qr(p_token text, p_claim_key text)
 RETURNS TABLE(status text, event_title text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_qr public.payment_qr_codes%rowtype;
  v_title text;
  v_hash text;
begin
  -- 受付の係が確認する企画では、学生がQRを読む方式は使えない
  if exists (
    select 1
      from public.payment_qr_codes gq
      join public.events ge on ge.id = gq.event_id
     where gq.token = p_token
       and ge.payment_confirm_mode = 'staff'
  ) then
    raise exception 'この企画では受付の係が支払いを確認します。受付の係にこの画面ではなく「自分の予約」のQRを見せてください。';
  end if;

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
end $function$;

CREATE OR REPLACE FUNCTION public.redeem_payment_qr(p_token text, p_claim_key text)
 RETURNS TABLE(event_id uuid, event_title text, paid_reservations integer, qr_mode text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_qr public.payment_qr_codes%rowtype;
  v_email text;
  v_count integer;
  v_title text;
  v_next_id uuid;
  v_next_token text;
  v_hash text;
begin
  -- 受付の係が確認する企画では、学生がQRを読む方式は使えない
  if exists (
    select 1
      from public.payment_qr_codes gq
      join public.events ge on ge.id = gq.event_id
     where gq.token = p_token
       and ge.payment_confirm_mode = 'staff'
  ) then
    raise exception 'この企画では受付の係が支払いを確認します。受付の係にこの画面ではなく「自分の予約」のQRを見せてください。';
  end if;

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
end $function$;
