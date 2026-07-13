-- Migration: 20260714000100_fix_get_event_slots_status.sql
-- Fixes get_event_slots to return reservation_status and walkin_status based on correct remaining capacity logic.
-- Fixes admin_pre_registrations condition to 'reserved', 'active', 'activation_failed'.

-- 1. get_event_slots
DROP FUNCTION IF EXISTS public.get_event_slots(uuid);
CREATE OR REPLACE FUNCTION public.get_event_slots(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  label text,
  starts_at timestamptz,
  ends_at timestamptz,
  is_enabled boolean,
  sort_order integer,
  total_capacity integer,
  reservation_capacity integer,
  reserved_count bigint,
  walkin_count bigint,
  remaining_reservation_slots bigint,
  remaining_walkin_slots bigint,
  reservation_starts_at timestamptz,
  reservation_ends_at timestamptz,
  ticket_use_starts_at timestamptz,
  ticket_use_ends_at timestamptz,
  walkin_starts_at timestamptz,
  walkin_ends_at timestamptz,
  is_reservation_enabled boolean,
  is_ticket_use_enabled boolean,
  is_walkin_enabled boolean,
  walkin_limit integer,
  capacity integer,
  remaining_slots bigint,
  reservation_use_starts_at timestamptz,
  reservation_use_ends_at timestamptz,
  walkin_use_starts_at timestamptz,
  walkin_use_ends_at timestamptz,
  reservation_status text,
  walkin_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH slots_data AS (
    SELECT
      es.id,
      es.label,
      es.starts_at,
      es.ends_at,
      es.is_enabled,
      es.sort_order,
      es.total_capacity,
      es.reservation_capacity,
      es.reservation_starts_at,
      es.reservation_ends_at,
      es.ticket_use_starts_at,
      es.ticket_use_ends_at,
      es.walkin_starts_at,
      es.walkin_ends_at,
      es.is_reservation_enabled,
      es.is_ticket_use_enabled,
      es.is_walkin_enabled,
      es.walkin_limit,
      es.created_at,
      e.is_reservation_suspended,
      e.is_walkin_suspended,
      e.auto_suspend_at,
      COALESCE(es.low_remaining_threshold, e.low_remaining_threshold, 10) AS resolved_low_remaining_threshold,
      COALESCE(es.low_remaining_threshold_type, e.low_remaining_threshold_type, 'count') AS resolved_low_remaining_threshold_type,
      (COALESCE(res.res_count, 0) + COALESCE(pre.pre_res_count, 0))::bigint AS reserved_count_val,
      (COALESCE(res.walk_count, 0) + COALESCE(pre.pre_walk_count, 0))::bigint AS walkin_count_val,
      GREATEST(LEAST(
        es.reservation_capacity - (COALESCE(res.res_count, 0) + COALESCE(pre.pre_res_count, 0)), 
        es.total_capacity - (COALESCE(res.res_count, 0) + COALESCE(pre.pre_res_count, 0) + COALESCE(res.walk_count, 0) + COALESCE(pre.pre_walk_count, 0))
      ), 0)::bigint AS rem_res_slots,
      GREATEST(LEAST(
        COALESCE(es.walkin_limit, es.total_capacity) - (COALESCE(res.walk_count, 0) + COALESCE(pre.pre_walk_count, 0)),
        es.total_capacity - (COALESCE(res.res_count, 0) + COALESCE(pre.pre_res_count, 0) + COALESCE(res.walk_count, 0) + COALESCE(pre.pre_walk_count, 0))
      ), 0)::bigint AS rem_walkin_slots
    FROM event_slots es
    JOIN events e ON es.event_id = e.id
    LEFT JOIN (
      SELECT 
        event_slot_id,
        count(*) FILTER (WHERE status IN ('reserved', 'used') AND ticket_type = 'reservation') AS res_count,
        count(*) FILTER (WHERE status IN ('reserved', 'used') AND ticket_type = 'walkin') AS walk_count
      FROM reservations
      GROUP BY event_slot_id
    ) res ON es.id = res.event_slot_id
    LEFT JOIN (
      SELECT 
        event_slot_id,
        count(*) FILTER (WHERE status IN ('reserved', 'active', 'activation_failed') AND ticket_type = 'reservation') AS pre_res_count,
        count(*) FILTER (WHERE status IN ('reserved', 'active', 'activation_failed') AND ticket_type = 'walkin') AS pre_walk_count
      FROM admin_pre_registrations
      GROUP BY event_slot_id
    ) pre ON es.id = pre.event_slot_id
    WHERE es.event_id = p_event_id
  )
  SELECT
    sd.id,
    sd.label,
    sd.starts_at,
    sd.ends_at,
    sd.is_enabled,
    sd.sort_order,
    sd.total_capacity,
    sd.reservation_capacity,
    sd.reserved_count_val AS reserved_count,
    sd.walkin_count_val AS walkin_count,
    sd.rem_res_slots AS remaining_reservation_slots,
    sd.rem_walkin_slots AS remaining_walkin_slots,
    sd.reservation_starts_at,
    sd.reservation_ends_at,
    sd.ticket_use_starts_at,
    sd.ticket_use_ends_at,
    sd.walkin_starts_at,
    sd.walkin_ends_at,
    sd.is_reservation_enabled,
    sd.is_ticket_use_enabled,
    sd.is_walkin_enabled,
    sd.walkin_limit,
    sd.reservation_capacity AS capacity,
    GREATEST(
      sd.total_capacity - (sd.reserved_count_val + sd.walkin_count_val), 
      0
    )::bigint AS remaining_slots,
    sd.ticket_use_starts_at AS reservation_use_starts_at,
    sd.ticket_use_ends_at AS reservation_use_ends_at,
    sd.walkin_starts_at AS walkin_use_starts_at,
    sd.walkin_ends_at AS walkin_use_ends_at,
    calculate_slot_status(
      sd.is_enabled, sd.is_reservation_enabled, sd.reservation_starts_at, sd.reservation_ends_at,
      LEAST(sd.reservation_capacity, sd.total_capacity),
      (LEAST(sd.reservation_capacity, sd.total_capacity) - sd.rem_res_slots)::bigint,
      sd.resolved_low_remaining_threshold,
      sd.resolved_low_remaining_threshold_type,
      'reservation', sd.is_reservation_suspended, sd.auto_suspend_at
    ) AS reservation_status,
    calculate_slot_status(
      sd.is_enabled, sd.is_walkin_enabled, sd.walkin_starts_at, sd.walkin_ends_at,
      LEAST(COALESCE(sd.walkin_limit, sd.total_capacity), sd.total_capacity),
      (LEAST(COALESCE(sd.walkin_limit, sd.total_capacity), sd.total_capacity) - sd.rem_walkin_slots)::bigint,
      sd.resolved_low_remaining_threshold,
      sd.resolved_low_remaining_threshold_type,
      'walkin', sd.is_walkin_suspended, sd.auto_suspend_at
    ) AS walkin_status
  FROM slots_data sd
  ORDER BY sd.sort_order, sd.starts_at, sd.created_at;
END;
$$;

-- 2. get_public_events
DROP FUNCTION IF EXISTS public.get_public_events();
CREATE OR REPLACE FUNCTION public.get_public_events()
RETURNS TABLE (
  id uuid,
  title text,
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  reservation_starts_at timestamptz,
  reservation_ends_at timestamptz,
  reservation_enabled boolean,
  ticket_enabled boolean,
  use_button_enabled boolean,
  use_starts_at timestamptz,
  use_ends_at timestamptz,
  allowed_email_domains text[],
  slot_selection_mode text,
  created_at timestamptz,
  has_walkin_active boolean,
  has_walkin_upcoming boolean,
  slots jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id, e.title, e.description, e.starts_at, e.ends_at,
    e.reservation_starts_at, e.reservation_ends_at, e.reservation_enabled,
    e.ticket_enabled, e.use_button_enabled, e.use_starts_at, e.use_ends_at,
    e.allowed_email_domains, e.slot_selection_mode, e.created_at,
    COALESCE(slot_stats.has_walkin_active, false) AS has_walkin_active,
    COALESCE(slot_stats.has_walkin_upcoming, false) AS has_walkin_upcoming,
    COALESCE(slot_stats.slots_json, '[]'::jsonb) AS slots
  FROM events e
  LEFT JOIN (
    SELECT
      es.event_id,
      COALESCE(bool_or(es.is_enabled = true AND es.is_walkin_enabled = true AND (es.walkin_starts_at IS NULL OR now() >= es.walkin_starts_at) AND (es.walkin_ends_at IS NULL OR now() <= es.walkin_ends_at) AND e.is_walkin_suspended = false AND (e.auto_suspend_at IS NULL OR now() < e.auto_suspend_at)), false) AS has_walkin_active,
      COALESCE(bool_or(es.is_enabled = true AND es.is_walkin_enabled = true AND es.walkin_starts_at IS NOT NULL AND now() < es.walkin_starts_at AND e.is_walkin_suspended = false AND (e.auto_suspend_at IS NULL OR now() < e.auto_suspend_at)), false) AS has_walkin_upcoming,
      jsonb_agg(
        jsonb_build_object(
          'id', es.id,
          'label', es.label,
          'starts_at', es.starts_at,
          'ends_at', es.ends_at,
          'is_enabled', es.is_enabled,
          'reservation_status', calculate_slot_status(
            es.is_enabled, es.is_reservation_enabled, es.reservation_starts_at, es.reservation_ends_at,
            LEAST(es.reservation_capacity, es.total_capacity),
            (LEAST(es.reservation_capacity, es.total_capacity) - GREATEST(LEAST(
              es.reservation_capacity - (COALESCE(r_counts.res_count, 0) + COALESCE(p_counts.pre_res_count, 0)), 
              es.total_capacity - (COALESCE(r_counts.res_count, 0) + COALESCE(p_counts.pre_res_count, 0) + COALESCE(r_counts.walk_count, 0) + COALESCE(p_counts.pre_walk_count, 0))
            ), 0))::bigint,
            COALESCE(es.low_remaining_threshold, e.low_remaining_threshold, 10),
            COALESCE(es.low_remaining_threshold_type, e.low_remaining_threshold_type, 'count'),
            'reservation', e.is_reservation_suspended, e.auto_suspend_at
          ),
          'walkin_status', calculate_slot_status(
            es.is_enabled, es.is_walkin_enabled, es.walkin_starts_at, es.walkin_ends_at,
            LEAST(COALESCE(es.walkin_limit, es.total_capacity), es.total_capacity),
            (LEAST(COALESCE(es.walkin_limit, es.total_capacity), es.total_capacity) - GREATEST(LEAST(
              COALESCE(es.walkin_limit, es.total_capacity) - (COALESCE(r_counts.walk_count, 0) + COALESCE(p_counts.pre_walk_count, 0)),
              es.total_capacity - (COALESCE(r_counts.res_count, 0) + COALESCE(p_counts.pre_res_count, 0) + COALESCE(r_counts.walk_count, 0) + COALESCE(p_counts.pre_walk_count, 0))
            ), 0))::bigint,
            COALESCE(es.low_remaining_threshold, e.low_remaining_threshold, 10),
            COALESCE(es.low_remaining_threshold_type, e.low_remaining_threshold_type, 'count'),
            'walkin', e.is_walkin_suspended, e.auto_suspend_at
          )
        ) ORDER BY es.sort_order, es.starts_at, es.created_at
      ) AS slots_json
    FROM event_slots es
    JOIN events e ON es.event_id = e.id
    LEFT JOIN (
      SELECT event_slot_id,
        count(*) FILTER (WHERE status IN ('reserved', 'used') AND ticket_type = 'reservation') AS res_count,
        count(*) FILTER (WHERE status IN ('reserved', 'used') AND ticket_type = 'walkin') AS walk_count
      FROM reservations GROUP BY event_slot_id
    ) r_counts ON es.id = r_counts.event_slot_id
    LEFT JOIN (
      SELECT event_slot_id,
        count(*) FILTER (WHERE status IN ('reserved', 'active', 'activation_failed') AND ticket_type = 'reservation') AS pre_res_count,
        count(*) FILTER (WHERE status IN ('reserved', 'active', 'activation_failed') AND ticket_type = 'walkin') AS pre_walk_count
      FROM admin_pre_registrations GROUP BY event_slot_id
    ) p_counts ON es.id = p_counts.event_slot_id
    WHERE es.is_enabled = true
    GROUP BY es.event_id
  ) slot_stats ON e.id = slot_stats.event_id
  WHERE e.is_public = true AND (e.auto_hide_at IS NULL OR now() < e.auto_hide_at)
  ORDER BY e.created_at DESC;
END;
$$;

-- 3. Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_event_slots(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_events() TO anon, authenticated;
