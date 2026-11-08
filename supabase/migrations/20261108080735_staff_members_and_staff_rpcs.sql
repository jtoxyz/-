-- 自治会などの「スタッフ」向けの限定権限（2026-11-07）
--
-- スタッフは管理画面に入れない。/staff 画面から、担当に割り当てられた企画についてだけ
--   ・動的支払いQR（端末ごとの一回限りQR）
--   ・1日支払いQR（その日の固定QR）
--   ・受付状況（枠ごとの予約数・受け取り済み・支払い済みなどの人数。個人情報は返さない）
--   ・支払い受付枠ごとの来室予定人数
-- を使える。企画の作成・編集・削除、予約者の氏名などは見られない。
--
-- スタッフは大学Googleアカウント（学生用ログイン）で入る。管理者が /admin/staff でメールアドレスと担当企画を登録する。
-- 管理者もこの RPC を使える（全企画）。

create table if not exists public.staff_members (
  id uuid primary key default gen_random_uuid(),
  email text not null unique
    check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  display_name text check (display_name is null or char_length(display_name) <= 100),
  note text check (note is null or char_length(note) <= 500),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
comment on table public.staff_members is '管理画面には入れないが、担当企画の支払いQRと受付状況だけを使えるスタッフ（自治会など）';

create table if not exists public.staff_event_access (
  staff_id uuid not null references public.staff_members(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (staff_id, event_id)
);
comment on table public.staff_event_access is 'スタッフが担当する企画';

create index if not exists idx_staff_event_access_event_id on public.staff_event_access(event_id);
create index if not exists idx_staff_members_created_by on public.staff_members(created_by) where created_by is not null;

alter table public.staff_members enable row level security;
alter table public.staff_event_access enable row level security;

create policy staff_members_admin_all on public.staff_members
  for all to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())))
  with check (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

create policy staff_event_access_admin_all on public.staff_event_access
  for all to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())))
  with check (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

revoke all on public.staff_members from anon;
revoke all on public.staff_event_access from anon;

-- ログイン中の利用者がスタッフなら、その staff_members.id（確認済みメールで照合）
create or replace function public.current_staff_id()
returns uuid
language sql
stable
security definer
set search_path to 'public', 'auth'
as $function$
  select s.id
    from public.staff_members s
    join auth.users u on lower(u.email) = s.email
   where u.id = auth.uid()
     and u.email_confirmed_at is not null
     and s.is_active
   limit 1;
$function$;

-- 管理者、またはその企画を担当するスタッフなら true
create or replace function public.can_operate_event(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (select 1 from public.admin_users au where au.user_id = auth.uid())
      or exists (
        select 1 from public.staff_event_access a
         where a.event_id = p_event_id
           and a.staff_id = public.current_staff_id()
      );
$function$;

revoke execute on function public.current_staff_id() from public, anon, authenticated;
revoke execute on function public.can_operate_event(uuid) from public, anon, authenticated;

-- 画面の出し分け用：自分がスタッフ（または管理者）か
create or replace function public.get_my_staff_status()
returns table(is_staff boolean, is_admin boolean, display_name text, event_count integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_staff_id uuid := public.current_staff_id();
begin
  return query
  select v_staff_id is not null,
         exists (select 1 from public.admin_users au where au.user_id = auth.uid()),
         (select s.display_name from public.staff_members s where s.id = v_staff_id),
         (select count(*)::integer from public.staff_event_access a where a.staff_id = v_staff_id);
end;
$function$;

-- 担当企画の一覧（管理者は全企画）
create or replace function public.staff_list_events()
returns table(id uuid, title text, payment_required boolean, is_public boolean, starts_at timestamptz, ends_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_is_admin boolean := exists (select 1 from public.admin_users au where au.user_id = auth.uid());
  v_staff_id uuid := public.current_staff_id();
begin
  if not v_is_admin and v_staff_id is null then
    raise exception 'スタッフとして登録されていません。';
  end if;

  return query
  select e.id, e.title, coalesce(e.payment_required, false), coalesce(e.is_public, false), e.starts_at, e.ends_at
    from public.events e
   where v_is_admin
      or exists (select 1 from public.staff_event_access a where a.event_id = e.id and a.staff_id = v_staff_id)
   order by e.starts_at desc nulls last, e.created_at desc;
end;
$function$;

-- 枠ごとの受付状況（人数だけ。個人情報は返さない）
create or replace function public.staff_get_event_stats(p_event_id uuid)
returns table(
  slot_id uuid,
  slot_label text,
  starts_at timestamptz,
  ends_at timestamptz,
  is_enabled boolean,
  total_capacity integer,
  reservation_count bigint,
  walkin_count bigint,
  used_count bigint,
  waiting_count bigint,
  cancelled_count bigint,
  paid_count bigint,
  unpaid_count bigint,
  remaining_reservation_slots bigint,
  remaining_walkin_slots bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  if not public.can_operate_event(p_event_id) then
    raise exception 'この企画を見る権限がありません。';
  end if;

  return query
  select s.id, s.label, s.starts_at, s.ends_at, s.is_enabled, s.total_capacity,
         count(r.id) filter (where r.status in ('reserved', 'used') and r.ticket_type = 'reservation'),
         count(r.id) filter (where r.status in ('reserved', 'used') and r.ticket_type = 'walkin'),
         count(r.id) filter (where r.status = 'used'),
         count(r.id) filter (where r.status = 'reserved'),
         count(r.id) filter (where r.status = 'cancelled'),
         count(r.id) filter (where r.status in ('reserved', 'used') and r.payment_status = 'paid'),
         count(r.id) filter (where r.status in ('reserved', 'used') and r.payment_status = 'pending'),
         max(gs.remaining_reservation_slots),
         max(gs.remaining_walkin_slots)
    from public.event_slots s
    left join public.reservations r on r.event_slot_id = s.id
    left join public.get_event_slots(p_event_id) gs on gs.id = s.id
   where s.event_id = p_event_id
   group by s.id
   order by s.sort_order, s.starts_at;
end;
$function$;

-- 支払い受付枠ごとの来室予定（この企画の予約だけ）
create or replace function public.staff_get_payment_visit_stats(p_event_id uuid)
returns table(
  visit_slot_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  location text,
  note text,
  waiting_count bigint,
  paid_count bigint,
  expired_count bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  if not public.can_operate_event(p_event_id) then
    raise exception 'この企画を見る権限がありません。';
  end if;

  return query
  select v.id, v.starts_at, v.ends_at, v.location, v.note,
         count(r.id) filter (where r.status = 'reserved' and r.payment_status = 'pending'),
         count(r.id) filter (where r.status <> 'cancelled' and r.payment_status = 'paid'),
         count(r.id) filter (where r.payment_status = 'expired')
    from public.payment_visit_slots v
    join public.reservations r on r.payment_visit_slot_id = v.id and r.event_id = p_event_id
   group by v.id
   order by v.starts_at;
end;
$function$;

-- この端末専用の動的支払いQR（admin_get_lane_payment_qr と同じ動き。担当スタッフも使える）
create or replace function public.staff_get_lane_payment_qr(p_event_id uuid, p_lane text)
returns table(qr_id uuid, qr_token text, created_at timestamptz)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
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
end;
$function$;

-- その日の1日支払いQR。すでに有効なQRがあればそれを返す（印刷済みのQRを無効にしない）。
-- p_reissue = true のときだけ、古いQRを無効にして新しく発行する（QRの写真が出回ったときなど）。
create or replace function public.staff_get_daily_payment_qr(
  p_event_id uuid,
  p_valid_date date default null,
  p_reissue boolean default false
)
returns table(
  qr_id uuid,
  qr_token text,
  valid_date date,
  valid_from timestamptz,
  valid_until timestamptz,
  redemption_count integer,
  created_at timestamptz
)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
#variable_conflict use_column
declare
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_date date := coalesce(p_valid_date, (now() at time zone 'Asia/Tokyo')::date);
  v_qr public.payment_qr_codes%rowtype;
begin
  if not public.can_operate_event(p_event_id) then
    raise exception 'この企画を操作する権限がありません。';
  end if;
  if not exists (select 1 from public.events e where e.id = p_event_id and coalesce(e.payment_required, false)) then
    raise exception '支払い必須の企画が見つかりません。';
  end if;
  if v_date < v_today or v_date > v_today + 60 then
    raise exception '使用日は今日から60日以内で選んでください。';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('payment_qr_daily:' || p_event_id::text || ':' || v_date::text, 0));

  if coalesce(p_reissue, false) then
    update public.payment_qr_codes q
       set is_active = false
     where q.event_id = p_event_id
       and q.mode = 'daily'
       and q.valid_date = v_date
       and q.is_active;
  else
    select * into v_qr
      from public.payment_qr_codes q
     where q.event_id = p_event_id
       and q.mode = 'daily'
       and q.valid_date = v_date
       and q.is_active
     order by q.created_at desc
     limit 1;
  end if;

  if v_qr.id is null then
    insert into public.payment_qr_codes(event_id, mode, token, valid_date, valid_from, valid_until, created_by)
    values (
      p_event_id,
      'daily',
      encode(gen_random_bytes(24), 'hex'),
      v_date,
      (v_date::timestamp at time zone 'Asia/Tokyo'),
      ((v_date + 1)::timestamp at time zone 'Asia/Tokyo'),
      auth.uid()
    )
    returning * into v_qr;
  end if;

  return query
  select v_qr.id, v_qr.token, v_qr.valid_date, v_qr.valid_from, v_qr.valid_until, v_qr.redemption_count, v_qr.created_at;
end;
$function$;

revoke execute on function public.get_my_staff_status() from public, anon;
revoke execute on function public.staff_list_events() from public, anon;
revoke execute on function public.staff_get_event_stats(uuid) from public, anon;
revoke execute on function public.staff_get_payment_visit_stats(uuid) from public, anon;
revoke execute on function public.staff_get_lane_payment_qr(uuid, text) from public, anon;
revoke execute on function public.staff_get_daily_payment_qr(uuid, date, boolean) from public, anon;

grant execute on function public.get_my_staff_status() to authenticated;
grant execute on function public.staff_list_events() to authenticated;
grant execute on function public.staff_get_event_stats(uuid) to authenticated;
grant execute on function public.staff_get_payment_visit_stats(uuid) to authenticated;
grant execute on function public.staff_get_lane_payment_qr(uuid, text) to authenticated;
grant execute on function public.staff_get_daily_payment_qr(uuid, date, boolean) to authenticated;
