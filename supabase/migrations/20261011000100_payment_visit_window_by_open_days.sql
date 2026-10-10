-- 来室日時の選択範囲を「暦日」ではなく「支払い受付日（受付枠がある日）」で数える。
-- N = 0 は予約した日のうち。N >= 1 は「当日の残りの枠」＋「翌日以降で受付枠がある日を N 日分」。
-- 例：N = 1 で金曜に予約した場合、土日に枠がなければ月曜（祝日で枠がなければ次の受付日）の枠まで選べる。
-- null は制限なし。翌日以降の受付日が N 日分に満たない場合は、登録済みの枠すべてを選べる。
-- フロントエンドの filterVisitSlotsByWindow（src/lib/paymentVisit.ts）と同じ基準。

begin;

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
  v_today date;
  v_limit_date date;
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
    v_today := (now() at time zone 'Asia/Tokyo')::date;
    if v_window = 0 then
      v_limit_date := v_today;
    else
      select x.d into v_limit_date
      from (
        select distinct (s.starts_at at time zone 'Asia/Tokyo')::date as d
        from public.payment_visit_slots s
        where s.is_active
          and s.ends_at > now()
          and (s.starts_at at time zone 'Asia/Tokyo')::date > v_today
      ) x
      order by x.d
      offset v_window - 1
      limit 1;
    end if;

    if v_limit_date is not null and (v_slot.starts_at at time zone 'Asia/Tokyo')::date > v_limit_date then
      raise exception '選択した支払い日時は選べる期間外です。もっと早い日時を選択してください。';
    end if;
  end if;

  return v_slot;
end $$;

revoke all on function public.resolve_payment_visit_slot(uuid, uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
