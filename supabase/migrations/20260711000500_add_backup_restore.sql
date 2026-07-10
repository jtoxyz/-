-- Migration: Add JSON Backup and Restore RPCs
-- Date: 2026-07-11

-- 1. Export Backup RPC
CREATE OR REPLACE FUNCTION admin_export_event_backup(
  p_event_id uuid,
  p_include_reservations boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_is_admin boolean;
  v_event_record record;
  v_slots jsonb;
  v_reservations jsonb;
  v_result jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM admin_users WHERE id = v_user_id
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT * INTO v_event_record FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(es)), '[]'::jsonb) INTO v_slots
  FROM event_slots es
  WHERE es.event_id = p_event_id;

  v_reservations := NULL;
  IF p_include_reservations THEN
    SELECT COALESCE(jsonb_agg(row_to_json(res)), '[]'::jsonb) INTO v_reservations
    FROM reservations res
    WHERE res.event_id = p_event_id;
  END IF;

  v_result := jsonb_build_object(
    'schema_version', '1.0',
    'created_at', now(),
    'source_event_id', p_event_id,
    'backup_type', CASE WHEN p_include_reservations THEN 'full' ELSE 'config_only' END,
    'event', row_to_json(v_event_record),
    'event_slots', v_slots
  );

  IF p_include_reservations THEN
    v_result := jsonb_set(v_result, '{reservations}', v_reservations);
  END IF;

  RETURN v_result;
END;
$$;

-- 2. Restore Backup RPC
DROP FUNCTION IF EXISTS admin_restore_event_backup(jsonb);

CREATE OR REPLACE FUNCTION admin_restore_event_backup(
  p_json jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_is_admin boolean;
  v_new_event_id uuid;
  v_schema_version text;
  v_backup_type text;
  v_event_data jsonb;
  v_slots_data jsonb;
  v_reservations_data jsonb;
  v_slot jsonb;
  v_res jsonb;
  v_old_slot_id uuid;
  v_new_slot_id uuid;
  v_slot_mapping jsonb := '{}'::jsonb;
  v_new_public_token text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM admin_users WHERE id = v_user_id
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  v_schema_version := p_json->>'schema_version';
  IF v_schema_version IS NULL OR v_schema_version != '1.0' THEN
    RAISE EXCEPTION 'Unsupported backup schema version';
  END IF;

  v_backup_type := p_json->>'backup_type';
  IF v_backup_type NOT IN ('config_only', 'full') THEN
    RAISE EXCEPTION 'Invalid backup type';
  END IF;

  v_event_data := p_json->'event';
  v_slots_data := p_json->'event_slots';
  
  IF v_event_data IS NULL OR v_slots_data IS NULL THEN
    RAISE EXCEPTION 'Missing event or event_slots in backup';
  END IF;

  -- Create new event
  INSERT INTO events (
    title, description, capacity, starts_at, ends_at,
    reservation_starts_at, reservation_ends_at, use_starts_at, use_ends_at,
    is_public, reservation_enabled, ticket_enabled, use_button_enabled,
    allowed_email_domains, slot_selection_mode,
    survey_after_reservation_enabled, survey_after_reservation_url, survey_after_reservation_message,
    survey_after_use_enabled, survey_after_use_url, survey_after_use_message,
    is_reservation_suspended, is_walkin_suspended, is_ticket_use_suspended,
    auto_suspend_at, auto_hide_at,
    post_reservation_notes, low_remaining_threshold, low_remaining_threshold_type
  ) VALUES (
    (v_event_data->>'title') || '（復元）',
    v_event_data->>'description',
    (v_event_data->>'capacity')::integer,
    (v_event_data->>'starts_at')::timestamptz,
    (v_event_data->>'ends_at')::timestamptz,
    (v_event_data->>'reservation_starts_at')::timestamptz,
    (v_event_data->>'reservation_ends_at')::timestamptz,
    (v_event_data->>'use_starts_at')::timestamptz,
    (v_event_data->>'use_ends_at')::timestamptz,
    false, -- Force non-public
    false, -- reservation_enabled
    false, -- ticket_enabled
    false, -- use_button_enabled
    ARRAY(SELECT jsonb_array_elements_text(v_event_data->'allowed_email_domains')),
    v_event_data->>'slot_selection_mode',
    (v_event_data->>'survey_after_reservation_enabled')::boolean,
    v_event_data->>'survey_after_reservation_url',
    v_event_data->>'survey_after_reservation_message',
    (v_event_data->>'survey_after_use_enabled')::boolean,
    v_event_data->>'survey_after_use_url',
    v_event_data->>'survey_after_use_message',
    true, -- is_reservation_suspended
    true, -- is_walkin_suspended
    true, -- is_ticket_use_suspended
    NULL, -- auto_suspend_at
    NULL, -- auto_hide_at
    v_event_data->>'post_reservation_notes',
    (v_event_data->>'low_remaining_threshold')::integer,
    v_event_data->>'low_remaining_threshold_type'
  ) RETURNING id INTO v_new_event_id;

  -- Restore slots
  FOR v_slot IN SELECT * FROM jsonb_array_elements(v_slots_data)
  LOOP
    v_old_slot_id := (v_slot->>'id')::uuid;
    
    INSERT INTO event_slots (
      event_id, label, capacity, starts_at, ends_at,
      reservation_starts_at, reservation_ends_at, ticket_use_starts_at, ticket_use_ends_at,
      walkin_starts_at, walkin_ends_at,
      is_reservation_enabled, is_ticket_use_enabled, is_walkin_enabled,
      walkin_limit, sort_order, total_capacity
    ) VALUES (
      v_new_event_id,
      v_slot->>'label',
      (v_slot->>'capacity')::integer,
      (v_slot->>'starts_at')::timestamptz,
      (v_slot->>'ends_at')::timestamptz,
      (v_slot->>'reservation_starts_at')::timestamptz,
      (v_slot->>'reservation_ends_at')::timestamptz,
      (v_slot->>'ticket_use_starts_at')::timestamptz,
      (v_slot->>'ticket_use_ends_at')::timestamptz,
      (v_slot->>'walkin_starts_at')::timestamptz,
      (v_slot->>'walkin_ends_at')::timestamptz,
      (v_slot->>'is_reservation_enabled')::boolean,
      (v_slot->>'is_ticket_use_enabled')::boolean,
      (v_slot->>'is_walkin_enabled')::boolean,
      (v_slot->>'walkin_limit')::integer,
      (v_slot->>'sort_order')::integer,
      (v_slot->>'total_capacity')::integer
    ) RETURNING id INTO v_new_slot_id;
    
    -- Add to mapping
    v_slot_mapping := jsonb_set(v_slot_mapping, array[v_old_slot_id::text], to_jsonb(v_new_slot_id));
  END LOOP;

  -- Restore reservations if requested and present
  IF v_backup_type = 'full' THEN
    v_reservations_data := p_json->'reservations';
    IF v_reservations_data IS NOT NULL THEN
      FOR v_res IN SELECT * FROM jsonb_array_elements(v_reservations_data)
      LOOP
        v_old_slot_id := (v_res->>'event_slot_id')::uuid;
        v_new_slot_id := (v_slot_mapping->>v_old_slot_id::text)::uuid;
        
        IF v_new_slot_id IS NULL THEN
          RAISE EXCEPTION 'Invalid event_slot_id % in reservations data', v_old_slot_id;
        END IF;

        -- Generate new ticket token
        v_new_public_token := generate_secure_token(32);
        
        INSERT INTO reservations (
          event_id, event_slot_id, student_email, student_number, student_name,
          ticket_type, status, reserved_at, used_at, cancelled_at, public_token
        ) VALUES (
          v_new_event_id,
          v_new_slot_id,
          v_res->>'student_email',
          v_res->>'student_number',
          v_res->>'student_name',
          v_res->>'ticket_type',
          v_res->>'status',
          (v_res->>'reserved_at')::timestamptz,
          (v_res->>'used_at')::timestamptz,
          (v_res->>'cancelled_at')::timestamptz,
          v_new_public_token
        );
      END LOOP;
    END IF;
  END IF;

  RETURN v_new_event_id;
END;
$$;

-- Revoke and Grant
REVOKE ALL ON FUNCTION admin_export_event_backup(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_export_event_backup(uuid, boolean) TO anon, authenticated;

REVOKE ALL ON FUNCTION admin_restore_event_backup(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_restore_event_backup(jsonb) TO anon, authenticated;
