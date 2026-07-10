-- Admin Duplicate Event
CREATE OR REPLACE FUNCTION admin_duplicate_event(p_event_id uuid)
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
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'アクセス権限がありません。';
  END IF;

  SELECT * INTO v_old_event FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '元の企画が見つかりません。';
  END IF;

  INSERT INTO events (
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
    false, false, false, -- forced to disabled/private
    false, v_old_event.use_starts_at, v_old_event.use_ends_at,
    v_old_event.allowed_email_domains, v_old_event.slot_selection_mode,
    v_old_event.survey_after_reservation_enabled, v_old_event.survey_after_reservation_url, v_old_event.survey_after_reservation_message,
    v_old_event.survey_after_use_enabled, v_old_event.survey_after_use_url, v_old_event.survey_after_use_message,
    v_old_event.post_reservation_notes,
    true, true, true, -- all suspended
    v_old_event.auto_suspend_at, v_old_event.auto_hide_at, v_old_event.low_remaining_threshold, v_old_event.low_remaining_threshold_type
  ) RETURNING * INTO v_new_event;

  FOR v_old_slot IN SELECT * FROM event_slots WHERE event_id = p_event_id ORDER BY sort_order LOOP
    INSERT INTO event_slots (
      event_id, label, starts_at, ends_at, capacity, is_enabled, sort_order,
      total_capacity, reservation_capacity,
      reservation_starts_at, reservation_ends_at,
      ticket_use_starts_at, ticket_use_ends_at,
      walkin_starts_at, walkin_ends_at,
      is_reservation_enabled, is_ticket_use_enabled, is_walkin_enabled,
      walkin_limit, low_remaining_threshold, low_remaining_threshold_type
    ) VALUES (
      v_new_event.id, v_old_slot.label, v_old_slot.starts_at, v_old_slot.ends_at, v_old_slot.capacity, false, v_old_slot.sort_order,
      v_old_slot.total_capacity, v_old_slot.reservation_capacity,
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


-- Admin Restore Backup
CREATE OR REPLACE FUNCTION admin_restore_event_backup(p_backup_json jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_data jsonb;
  v_slots_data jsonb;
  v_res_data jsonb;
  v_pre_data jsonb;
  v_new_event_id uuid;
  v_slot_element jsonb;
  v_res_element jsonb;
  v_pre_element jsonb;
  v_old_slot_id text;
  v_new_slot_id uuid;
  v_slot_mapping jsonb DEFAULT '{}'::jsonb;
  v_public_token text;
  v_ticket_code text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'アクセス権限がありません。';
  END IF;

  v_event_data := p_backup_json->'event';
  v_slots_data := p_backup_json->'slots';
  v_res_data := p_backup_json->'reservations';
  v_pre_data := p_backup_json->'pre_registrations';

  IF v_event_data IS NULL THEN
    RAISE EXCEPTION 'バックアップデータに企画設定が含まれていません。';
  END IF;

  -- Create event as private and suspended
  INSERT INTO events (
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
    (v_event_data->>'title')::text,
    (v_event_data->>'description')::text,
    (v_event_data->>'capacity')::integer,
    (v_event_data->>'starts_at')::timestamptz,
    (v_event_data->>'ends_at')::timestamptz,
    (v_event_data->>'reservation_starts_at')::timestamptz,
    (v_event_data->>'reservation_ends_at')::timestamptz,
    false, false, false, false,
    (v_event_data->>'use_starts_at')::timestamptz,
    (v_event_data->>'use_ends_at')::timestamptz,
    ARRAY(SELECT jsonb_array_elements_text(v_event_data->'allowed_email_domains')),
    (v_event_data->>'slot_selection_mode')::text,
    (v_event_data->>'survey_after_reservation_enabled')::boolean,
    (v_event_data->>'survey_after_reservation_url')::text,
    (v_event_data->>'survey_after_reservation_message')::text,
    (v_event_data->>'survey_after_use_enabled')::boolean,
    (v_event_data->>'survey_after_use_url')::text,
    (v_event_data->>'survey_after_use_message')::text,
    (v_event_data->>'post_reservation_notes')::text,
    true, true, true,
    (v_event_data->>'auto_suspend_at')::timestamptz,
    (v_event_data->>'auto_hide_at')::timestamptz,
    (v_event_data->>'low_remaining_threshold')::integer,
    (v_event_data->>'low_remaining_threshold_type')::text
  ) RETURNING id INTO v_new_event_id;

  -- Create slots and build mapping
  IF v_slots_data IS NOT NULL AND jsonb_typeof(v_slots_data) = 'array' THEN
    FOR v_slot_element IN SELECT * FROM jsonb_array_elements(v_slots_data) LOOP
      v_old_slot_id := v_slot_element->>'id';
      
      INSERT INTO event_slots (
        event_id, label, starts_at, ends_at, capacity, is_enabled, sort_order,
        total_capacity, reservation_capacity,
        reservation_starts_at, reservation_ends_at,
        ticket_use_starts_at, ticket_use_ends_at,
        walkin_starts_at, walkin_ends_at,
        is_reservation_enabled, is_ticket_use_enabled, is_walkin_enabled,
        walkin_limit, low_remaining_threshold, low_remaining_threshold_type
      ) VALUES (
        v_new_event_id,
        (v_slot_element->>'label')::text,
        (v_slot_element->>'starts_at')::timestamptz,
        (v_slot_element->>'ends_at')::timestamptz,
        (v_slot_element->>'capacity')::integer,
        false, -- disabled
        (v_slot_element->>'sort_order')::integer,
        (v_slot_element->>'total_capacity')::integer,
        (v_slot_element->>'reservation_capacity')::integer,
        (v_slot_element->>'reservation_starts_at')::timestamptz,
        (v_slot_element->>'reservation_ends_at')::timestamptz,
        (v_slot_element->>'ticket_use_starts_at')::timestamptz,
        (v_slot_element->>'ticket_use_ends_at')::timestamptz,
        (v_slot_element->>'walkin_starts_at')::timestamptz,
        (v_slot_element->>'walkin_ends_at')::timestamptz,
        false, false, false,
        (v_slot_element->>'walkin_limit')::integer,
        (v_slot_element->>'low_remaining_threshold')::integer,
        (v_slot_element->>'low_remaining_threshold_type')::text
      ) RETURNING id INTO v_new_slot_id;

      IF v_old_slot_id IS NOT NULL THEN
        v_slot_mapping := jsonb_set(v_slot_mapping, array[v_old_slot_id], to_jsonb(v_new_slot_id::text));
      END IF;
    END LOOP;
  END IF;

  -- Create reservations
  IF v_res_data IS NOT NULL AND jsonb_typeof(v_res_data) = 'array' THEN
    FOR v_res_element IN SELECT * FROM jsonb_array_elements(v_res_data) LOOP
      v_old_slot_id := v_res_element->>'event_slot_id';
      IF v_old_slot_id IS NOT NULL AND v_slot_mapping ? v_old_slot_id THEN
        v_new_slot_id := (v_slot_mapping->>v_old_slot_id)::uuid;
      ELSE
        v_new_slot_id := NULL;
      END IF;

      v_public_token := gen_random_uuid()::text;
      LOOP
        v_ticket_code := upper(substring(md5(random()::text) from 1 for 8));
        IF NOT EXISTS (SELECT 1 FROM reservations WHERE ticket_code = v_ticket_code) THEN
          EXIT;
        END IF;
      END LOOP;

      INSERT INTO reservations (
        event_id, event_slot_id, student_name, student_number,
        university_email, ticket_code, public_token, status, ticket_type,
        used_at, cancelled_at, created_at
      ) VALUES (
        v_new_event_id,
        v_new_slot_id,
        (v_res_element->>'student_name')::text,
        (v_res_element->>'student_number')::text,
        (v_res_element->>'university_email')::text,
        v_ticket_code,
        v_public_token,
        (v_res_element->>'status')::text,
        (v_res_element->>'ticket_type')::text,
        (v_res_element->>'used_at')::timestamptz,
        (v_res_element->>'cancelled_at')::timestamptz,
        COALESCE((v_res_element->>'created_at')::timestamptz, now())
      );
    END LOOP;
  END IF;

  -- Create pre registrations
  IF v_pre_data IS NOT NULL AND jsonb_typeof(v_pre_data) = 'array' THEN
    FOR v_pre_element IN SELECT * FROM jsonb_array_elements(v_pre_data) LOOP
      v_old_slot_id := v_pre_element->>'event_slot_id';
      IF v_old_slot_id IS NOT NULL AND v_slot_mapping ? v_old_slot_id THEN
        v_new_slot_id := (v_slot_mapping->>v_old_slot_id)::uuid;
      ELSE
        v_new_slot_id := NULL;
      END IF;

      INSERT INTO admin_pre_registrations (
        event_id, event_slot_id, student_name, student_number,
        university_email, ticket_type, status, activation_error,
        created_at, activated_at
      ) VALUES (
        v_new_event_id,
        v_new_slot_id,
        (v_pre_element->>'student_name')::text,
        (v_pre_element->>'student_number')::text,
        (v_pre_element->>'university_email')::text,
        (v_pre_element->>'ticket_type')::text,
        (v_pre_element->>'status')::text,
        (v_pre_element->>'activation_error')::text,
        COALESCE((v_pre_element->>'created_at')::timestamptz, now()),
        (v_pre_element->>'activated_at')::timestamptz
      );
    END LOOP;
  END IF;

  RETURN json_build_object('id', v_new_event_id);
END;
$$;
