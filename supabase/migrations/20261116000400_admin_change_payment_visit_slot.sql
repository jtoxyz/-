-- 管理者が予約者一覧から、未払いの予約の「支払いに来る日時（payment_visit_slots）」を変更する。
-- ・未払い（payment_status = 'pending'）でキャンセルされていない予約だけが対象。
-- ・選べるのは有効で、まだ終わっていない支払い日時。予約時の選択範囲（payment_visit_window_days）は管理者判断で無視する。
-- ・支払い期限（payment_due_at）は新しい支払い日時の終了時刻にそろえる。
-- ・操作は admin_action_logs に記録する。

begin;

create or replace function public.admin_change_payment_visit_slot(
  p_reservation_id uuid,
  p_payment_visit_slot_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_admin uuid := auth.uid();
  v_res public.reservations%rowtype;
  v_visit public.payment_visit_slots%rowtype;
  v_old_slot_id uuid;
begin
  if not exists (select 1 from public.admin_users au where au.user_id = v_admin) then
    raise exception '管理者権限が必要です。';
  end if;

  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then
    raise exception '予約が見つかりません。';
  end if;
  if v_res.status = 'cancelled' then
    raise exception 'キャンセルされた予約は変更できません。';
  end if;
  if v_res.payment_status is distinct from 'pending' then
    raise exception '未払いの予約だけ支払い日時を変更できます。';
  end if;

  select * into v_visit from public.payment_visit_slots
  where id = p_payment_visit_slot_id and is_active and ends_at > now();
  if not found then
    raise exception '選んだ支払い日時は使えません。終了前の支払い日時を選んでください。';
  end if;

  v_old_slot_id := v_res.payment_visit_slot_id;

  update public.reservations
     set payment_visit_slot_id = v_visit.id,
         payment_due_at = v_visit.ends_at
   where id = v_res.id
  returning * into v_res;

  insert into public.admin_action_logs(action, target_table, target_id, details, actor_user_id)
  values (
    'admin_change_payment_visit_slot', 'reservations', v_res.id::text,
    jsonb_build_object(
      'student_number', v_res.student_number,
      'event_id', v_res.event_id,
      'old_payment_visit_slot_id', v_old_slot_id,
      'new_payment_visit_slot_id', v_visit.id
    ),
    v_admin
  );

  return jsonb_build_object(
    'id', v_res.id,
    'payment_visit_slot_id', v_res.payment_visit_slot_id,
    'payment_due_at', v_res.payment_due_at
  );
end;
$$;

revoke all on function public.admin_change_payment_visit_slot(uuid, uuid) from public, anon;
grant execute on function public.admin_change_payment_visit_slot(uuid, uuid) to authenticated;

commit;
