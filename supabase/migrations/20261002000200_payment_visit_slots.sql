-- 委員会室での支払い受付枠（全企画共通）
-- 企画で payment_visit_required を有効にすると、予約時に来室日時の選択が必須になり、
-- 支払期限は選んだ枠の終了時刻になる（未払いのまま過ぎると既存の仕組みで自動キャンセル）。

begin;

create table if not exists public.payment_visit_slots (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint payment_visit_slots_time_check check (ends_at > starts_at)
);

create index if not exists idx_payment_visit_slots_starts_at on public.payment_visit_slots (starts_at);

alter table public.payment_visit_slots enable row level security;

drop policy if exists payment_visit_slots_authenticated_read on public.payment_visit_slots;
create policy payment_visit_slots_authenticated_read on public.payment_visit_slots
  for select to authenticated
  using (is_active or exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

drop policy if exists payment_visit_slots_admin_insert on public.payment_visit_slots;
create policy payment_visit_slots_admin_insert on public.payment_visit_slots
  for insert to authenticated
  with check (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

drop policy if exists payment_visit_slots_admin_update on public.payment_visit_slots;
create policy payment_visit_slots_admin_update on public.payment_visit_slots
  for update to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())))
  with check (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

drop policy if exists payment_visit_slots_admin_delete on public.payment_visit_slots;
create policy payment_visit_slots_admin_delete on public.payment_visit_slots
  for delete to authenticated
  using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

revoke all on public.payment_visit_slots from anon;
grant select, insert, update, delete on public.payment_visit_slots to authenticated;

alter table public.events
  add column if not exists payment_visit_required boolean not null default false;

alter table public.reservations
  add column if not exists payment_visit_slot_id uuid references public.payment_visit_slots(id) on delete restrict;

create index if not exists idx_reservations_payment_visit_slot_id on public.reservations (payment_visit_slot_id);

-- 来室枠の検証。企画が来室必須でなければ null を返す（引数は無視）。
create or replace function public.resolve_payment_visit_slot(p_event_id uuid, p_payment_visit_slot_id uuid)
returns public.payment_visit_slots
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_required boolean;
  v_slot public.payment_visit_slots%rowtype;
begin
  select coalesce(payment_required, false) and coalesce(payment_visit_required, false)
    into v_required
  from public.events where id = p_event_id;

  if not coalesce(v_required, false) then
    return null;
  end if;

  if p_payment_visit_slot_id is null then
    raise exception '委員会室に支払いに来る日時を選択してください。';
  end if;

  select * into v_slot from public.payment_visit_slots
  where id = p_payment_visit_slot_id and is_active and ends_at > now();

  if not found then
    raise exception '選択した支払い日時は受付できません。別の日時を選択してください。';
  end if;

  return v_slot;
end $$;

revoke all on function public.resolve_payment_visit_slot(uuid, uuid) from public, anon, authenticated;

drop function if exists public.create_my_reservation(uuid, uuid);
create function public.create_my_reservation(
  p_event_id uuid,
  p_event_slot_id uuid,
  p_payment_visit_slot_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_uid uuid:=auth.uid(); v_profile public.user_profiles%rowtype; v_visit public.payment_visit_slots%rowtype; v_result jsonb;
begin
 if v_uid is null then raise exception '大学Googleアカウントでログインしてください。'; end if;
 select * into v_profile from public.user_profiles where user_id=v_uid;
 if not found then raise exception '初回アカウント登録を完了してください。'; end if;
 v_visit:=public.resolve_payment_visit_slot(p_event_id,p_payment_visit_slot_id);
 v_result:=public.create_reservation(p_event_id,p_event_slot_id,v_profile.student_name,v_profile.student_number,v_profile.university_email,null);
 update public.reservations set user_id=v_uid where id=(v_result->>'id')::uuid;
 if v_visit.id is not null then
   update public.reservations
   set payment_visit_slot_id=v_visit.id, payment_due_at=v_visit.ends_at
   where id=(v_result->>'id')::uuid and payment_status='pending';
 end if;
 return v_result;
end $$;

drop function if exists public.create_my_reservations_bulk(uuid, uuid[]);
create function public.create_my_reservations_bulk(
  p_event_id uuid,
  p_event_slot_ids uuid[],
  p_payment_visit_slot_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_uid uuid:=auth.uid(); v_profile public.user_profiles%rowtype; v_visit public.payment_visit_slots%rowtype; v_result json;
begin
 if v_uid is null then raise exception '大学Googleアカウントでログインしてください。'; end if;
 select * into v_profile from public.user_profiles where user_id=v_uid;
 if not found then raise exception '初回アカウント登録を完了してください。'; end if;
 v_visit:=public.resolve_payment_visit_slot(p_event_id,p_payment_visit_slot_id);
 v_result:=public.create_reservations_bulk(p_event_id,p_event_slot_ids,v_profile.student_name,v_profile.student_number,v_profile.university_email);
 update public.reservations r set user_id=v_uid where r.id in(select (item->>'id')::uuid from json_array_elements(v_result) item);
 if v_visit.id is not null then
   update public.reservations r
   set payment_visit_slot_id=v_visit.id, payment_due_at=v_visit.ends_at
   where r.id in(select (item->>'id')::uuid from json_array_elements(v_result) item) and r.payment_status='pending';
 end if;
 return v_result::jsonb;
end $$;

revoke all on function public.create_my_reservation(uuid, uuid, uuid) from public, anon;
revoke all on function public.create_my_reservations_bulk(uuid, uuid[], uuid) from public, anon;
grant execute on function public.create_my_reservation(uuid, uuid, uuid) to authenticated;
grant execute on function public.create_my_reservations_bulk(uuid, uuid[], uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
