-- 来室日時の選択範囲を「予約した日から N 日後まで（日本時間の暦日）」に制限する。
-- N = 0 は当日中、1 は翌日まで。null は制限なし。
-- 判定は受付枠の開始時刻で行う（N 日後の 23:59 までに始まる枠を選べる）。

begin;

alter table public.events
  add column if not exists payment_visit_window_days integer default 1;

alter table public.events
  drop constraint if exists events_payment_visit_window_days_check;
alter table public.events
  add constraint events_payment_visit_window_days_check
  check (payment_visit_window_days is null or payment_visit_window_days between 0 and 30);

create or replace function public.resolve_payment_visit_slot(p_event_id uuid, p_payment_visit_slot_id uuid)
returns public.payment_visit_slots
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_required boolean;
  v_window integer;
  v_limit timestamptz;
  v_slot public.payment_visit_slots%rowtype;
begin
  select coalesce(payment_required, false) and coalesce(payment_visit_required, false), payment_visit_window_days
    into v_required, v_window
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

  if v_window is not null then
    v_limit := ((now() at time zone 'Asia/Tokyo')::date + v_window + 1)::timestamp at time zone 'Asia/Tokyo';
    if v_slot.starts_at >= v_limit then
      raise exception '選択した支払い日時は選べる期間外です。もっと早い日時を選択してください。';
    end if;
  end if;

  return v_slot;
end $$;

revoke all on function public.resolve_payment_visit_slot(uuid, uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
