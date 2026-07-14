CREATE OR REPLACE FUNCTION public.use_ticket(p_public_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation public.reservations%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_use_starts_at timestamptz;
  v_use_ends_at timestamptz;
  v_use_enabled boolean;
BEGIN
  SELECT * INTO v_reservation
  FROM public.reservations
  WHERE public_token = p_public_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'チケットが見つかりません。';
  END IF;

  IF v_reservation.status = 'cancelled' THEN
    RAISE EXCEPTION 'このチケットはキャンセルされています。';
  END IF;

  IF v_reservation.status = 'used' THEN
    RETURN json_build_object('status', 'used', 'used_at', v_reservation.used_at);
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = v_reservation.event_id;

  IF v_event.is_ticket_use_suspended
     OR (v_event.auto_suspend_at IS NOT NULL AND now() >= v_event.auto_suspend_at) THEN
    RAISE EXCEPTION '現在、チケットを使用できません。';
  END IF;

  IF v_event.ticket_enabled IS DISTINCT FROM true
     OR v_event.use_button_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'このイベントではチケットの使用ボタンが有効化されていません。';
  END IF;

  SELECT
    CASE WHEN v_reservation.ticket_type = 'walkin'
      THEN COALESCE(es.walkin_use_starts_at, es.walkin_starts_at)
      ELSE COALESCE(es.reservation_use_starts_at, es.ticket_use_starts_at)
    END,
    CASE WHEN v_reservation.ticket_type = 'walkin'
      THEN COALESCE(es.walkin_use_ends_at, es.walkin_ends_at)
      ELSE COALESCE(es.reservation_use_ends_at, es.ticket_use_ends_at)
    END,
    CASE WHEN v_reservation.ticket_type = 'walkin'
      THEN es.is_walkin_enabled
      ELSE es.is_ticket_use_enabled
    END
  INTO v_use_starts_at, v_use_ends_at, v_use_enabled
  FROM public.event_slots es
  WHERE es.id = v_reservation.event_slot_id;

  IF v_use_enabled IS DISTINCT FROM true THEN
    IF v_reservation.ticket_type = 'walkin' THEN
      RAISE EXCEPTION 'この当日券は使用不可に設定されています。';
    ELSE
      RAISE EXCEPTION 'この予約券は使用不可に設定されています。';
    END IF;
  END IF;

  IF v_use_starts_at IS NOT NULL AND now() < v_use_starts_at THEN
    RAISE EXCEPTION 'このチケットはまだ使用できません';
  END IF;

  IF v_use_ends_at IS NOT NULL AND now() > v_use_ends_at THEN
    RAISE EXCEPTION 'このチケットの使用可能時間は終了しました';
  END IF;

  UPDATE public.reservations
  SET status = 'used', used_at = now()
  WHERE id = v_reservation.id AND status = 'reserved'
  RETURNING * INTO v_reservation;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'チケットはすでに使用されています。';
  END IF;

  RETURN json_build_object('status', v_reservation.status, 'used_at', v_reservation.used_at);
END;
$$;

GRANT EXECUTE ON FUNCTION public.use_ticket(text) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';