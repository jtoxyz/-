-- Fix admin event duplication after removing event_slots.capacity.
-- Also copy all current slot-level reservation/use/walk-in time settings.

CREATE OR REPLACE FUNCTION public.admin_duplicate_event(p_event_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_event record;
  v_new_event record;
  v_old_slot record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'アクセス権限がありません。';
  END IF;

  SELECT * INTO v_old_event
  FROM public.events
  WHERE id = p_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '元の企画が見つかりません。';
  END IF;

  INSERT INTO public.events (
    title, description, capacity, starts_at, ends_at,
    reservation_starts_at, reservation_ends_at,
    is_public, reservation_enabled, ticket_enabled,
    use_button_enabled, use_starts_at, use_ends_at,
    allowed_email_domains, slot_selection_mode,
    survey_after_reservation_enabled, survey_after_reservation_url, survey_after_reservation_message,
    survey_after_use_enabled, survey_after_use_url, survey_after_use_message,
    post_reservation_notes,
    is_reservation_suspended, is_walkin_suspended, is_ticket_use_suspended,
    auto_suspend_at, auto_hide_at, low_remaining_threshold, low_remaining_threshold_type
  ) VALUES (
    v_old_event.title || ' コピー', v_old_event.description, v_old_event.capacity, v_old_event.starts_at, v_old_event.ends_at,
    v_old_event.reservation_starts_at, v_old_event.reservation_ends_at,
    false, false, false,
    false, v_old_event.use_starts_at, v_old_event.use_ends_at,
    v_old_event.allowed_email_domains, v_old_event.slot_selection_mode,
    v_old_event.survey_after_reservation_enabled, v_old_event.survey_after_reservation_url, v_old_event.survey_after_reservation_message,
    v_old_event.survey_after_use_enabled, v_old_event.survey_after_use_url, v_old_event.survey_after_use_message,
    v_old_event.post_reservation_notes,
    true, true, true,
    v_old_event.auto_suspend_at, v_old_event.auto_hide_at, v_old_event.low_remaining_threshold, v_old_event.low_remaining_threshold_type
  )
  RETURNING * INTO v_new_event;

  FOR v_old_slot IN
    SELECT *
    FROM public.event_slots
    WHERE event_id = p_event_id
    ORDER BY sort_order
  LOOP
    INSERT INTO public.event_slots (
      event_id, label, starts_at, ends_at,
      reservation_capacity, is_enabled, sort_order, total_capacity,
      reservation_use_starts_at, reservation_use_ends_at,
      walkin_use_starts_at, walkin_use_ends_at,
      reservation_starts_at, reservation_ends_at,
      ticket_use_starts_at, ticket_use_ends_at,
      walkin_starts_at, walkin_ends_at,
      is_reservation_enabled, is_ticket_use_enabled, is_walkin_enabled,
      walkin_limit, low_remaining_threshold, low_remaining_threshold_type
    ) VALUES (
      v_new_event.id, v_old_slot.label, v_old_slot.starts_at, v_old_slot.ends_at,
      v_old_slot.reservation_capacity, false, v_old_slot.sort_order, v_old_slot.total_capacity,
      v_old_slot.reservation_use_starts_at, v_old_slot.reservation_use_ends_at,
      v_old_slot.walkin_use_starts_at, v_old_slot.walkin_use_ends_at,
      v_old_slot.reservation_starts_at, v_old_slot.reservation_ends_at,
      v_old_slot.ticket_use_starts_at, v_old_slot.ticket_use_ends_at,
      v_old_slot.walkin_starts_at, v_old_slot.walkin_ends_at,
      false, false, false,
      v_old_slot.walkin_limit, v_old_slot.low_remaining_threshold, v_old_slot.low_remaining_threshold_type
    );
  END LOOP;

  RETURN json_build_object('id', v_new_event.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_duplicate_event(uuid) TO authenticated;
