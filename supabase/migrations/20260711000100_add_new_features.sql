-- Add new columns to events
ALTER TABLE events
  ADD COLUMN post_reservation_notes text,
  ADD COLUMN is_reservation_suspended boolean DEFAULT false,
  ADD COLUMN is_walkin_suspended boolean DEFAULT false,
  ADD COLUMN is_ticket_use_suspended boolean DEFAULT false,
  ADD COLUMN auto_suspend_at timestamptz,
  ADD COLUMN auto_hide_at timestamptz,
  ADD COLUMN low_remaining_threshold integer DEFAULT 10,
  ADD COLUMN low_remaining_threshold_type text DEFAULT 'count' CHECK (low_remaining_threshold_type IN ('count', 'percent'));

-- Add new columns to event_slots
ALTER TABLE event_slots
  ADD COLUMN low_remaining_threshold integer,
  ADD COLUMN low_remaining_threshold_type text CHECK (low_remaining_threshold_type IN ('count', 'percent', NULL));

-- Create admin_pre_registrations table
CREATE TABLE admin_pre_registrations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  event_slot_id uuid REFERENCES event_slots(id) ON DELETE CASCADE,
  student_name text NOT NULL,
  student_number text NOT NULL,
  university_email text NOT NULL,
  ticket_type text NOT NULL CHECK (ticket_type IN ('reservation', 'walkin')),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'active', 'activation_failed', 'cancelled')),
  activation_error text,
  created_at timestamptz DEFAULT now(),
  activated_at timestamptz
);

-- Enable RLS on admin_pre_registrations
ALTER TABLE admin_pre_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access on admin_pre_registrations" ON admin_pre_registrations
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));

-- Drop functions whose return tables will change
DROP FUNCTION IF EXISTS get_event_slots(uuid);
DROP FUNCTION IF EXISTS get_public_events();

-- Helper function to calculate slot status
CREATE OR REPLACE FUNCTION calculate_slot_status(
  p_is_enabled boolean,
  p_is_type_enabled boolean,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_total_capacity integer,
  p_used_capacity bigint,
  p_threshold integer,
  p_threshold_type text,
  p_type text, -- 'reservation' or 'walkin'
  p_is_suspended boolean,
  p_auto_suspend_at timestamptz
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_remaining bigint;
  v_threshold_val numeric;
  v_percent numeric;
BEGIN
  IF p_is_suspended = true OR (p_auto_suspend_at IS NOT NULL AND now() >= p_auto_suspend_at) THEN
    RETURN 'suspended';
  END IF;

  IF p_is_enabled = false OR p_is_type_enabled = false THEN
    RETURN CASE WHEN p_type = 'walkin' THEN 'walkin_closed' ELSE 'closed' END;
  END IF;

  IF p_starts_at IS NOT NULL AND now() < p_starts_at THEN
    RETURN CASE WHEN p_type = 'walkin' THEN 'walkin_upcoming' ELSE 'before_open' END;
  END IF;

  IF p_ends_at IS NOT NULL AND now() > p_ends_at THEN
    RETURN CASE WHEN p_type = 'walkin' THEN 'walkin_closed' ELSE 'closed' END;
  END IF;

  v_remaining := GREATEST(p_total_capacity - p_used_capacity, 0);

  IF v_remaining <= 0 THEN
    RETURN CASE WHEN p_type = 'walkin' THEN 'walkin_full' ELSE 'full' END;
  END IF;

  IF p_threshold_type = 'percent' THEN
    IF p_total_capacity = 0 THEN
      v_percent := 0;
    ELSE
      v_percent := (v_remaining::numeric / p_total_capacity::numeric) * 100;
    END IF;
    IF v_percent <= p_threshold THEN
      RETURN CASE WHEN p_type = 'walkin' THEN 'walkin_low_remaining' ELSE 'low_remaining' END;
    END IF;
  ELSE
    IF v_remaining <= p_threshold THEN
      RETURN CASE WHEN p_type = 'walkin' THEN 'walkin_low_remaining' ELSE 'low_remaining' END;
    END IF;
  END IF;

  RETURN CASE WHEN p_type = 'walkin' THEN 'walkin_available' ELSE 'available' END;
END;
$$;

-- Admin get event slots
CREATE OR REPLACE FUNCTION admin_get_event_slots(p_event_id uuid)
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
  pre_registered_reserved_count bigint,
  pre_registered_walkin_count bigint,
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
  low_remaining_threshold integer,
  low_remaining_threshold_type text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Authenticate admin
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'アクセス権限がありません。';
  END IF;

  RETURN QUERY
  SELECT
    es.id, es.label, es.starts_at, es.ends_at, es.is_enabled, es.sort_order,
    es.total_capacity, es.reservation_capacity,
    COALESCE(res.res_count, 0)::bigint AS reserved_count,
    COALESCE(res.walk_count, 0)::bigint AS walkin_count,
    COALESCE(pre.pre_res_count, 0)::bigint AS pre_registered_reserved_count,
    COALESCE(pre.pre_walk_count, 0)::bigint AS pre_registered_walkin_count,
    GREATEST(LEAST(
      es.reservation_capacity - COALESCE(res.res_count, 0) - COALESCE(pre.pre_res_count, 0),
      es.total_capacity - COALESCE(res.res_count, 0) - COALESCE(pre.pre_res_count, 0) - COALESCE(res.walk_count, 0) - COALESCE(pre.pre_walk_count, 0)
    ), 0)::bigint AS remaining_reservation_slots,
    GREATEST(LEAST(
      es.total_capacity - COALESCE(res.res_count, 0) - COALESCE(pre.pre_res_count, 0) - COALESCE(res.walk_count, 0) - COALESCE(pre.pre_walk_count, 0),
      COALESCE(es.walkin_limit, es.total_capacity) - COALESCE(res.walk_count, 0) - COALESCE(pre.pre_walk_count, 0)
    ), 0)::bigint AS remaining_walkin_slots,
    es.reservation_starts_at, es.reservation_ends_at, es.ticket_use_starts_at, es.ticket_use_ends_at,
    es.walkin_starts_at, es.walkin_ends_at, es.is_reservation_enabled, es.is_ticket_use_enabled, es.is_walkin_enabled,
    es.walkin_limit, es.low_remaining_threshold, es.low_remaining_threshold_type
  FROM event_slots es
  LEFT JOIN (
    SELECT event_slot_id,
      count(*) FILTER (WHERE status IN ('reserved', 'used') AND ticket_type = 'reservation') AS res_count,
      count(*) FILTER (WHERE status IN ('reserved', 'used') AND ticket_type = 'walkin') AS walk_count
    FROM reservations GROUP BY event_slot_id
  ) res ON es.id = res.event_slot_id
  LEFT JOIN (
    SELECT event_slot_id,
      count(*) FILTER (WHERE status IN ('reserved', 'active', 'activation_failed') AND ticket_type = 'reservation') AS pre_res_count,
      count(*) FILTER (WHERE status IN ('reserved', 'active', 'activation_failed') AND ticket_type = 'walkin') AS pre_walk_count
    FROM admin_pre_registrations GROUP BY event_slot_id
  ) pre ON es.id = pre.event_slot_id
  WHERE es.event_id = p_event_id
  ORDER BY es.sort_order, es.starts_at, es.created_at;
END;
$$;

-- Public get_event_slots with exact counts hidden
CREATE OR REPLACE FUNCTION get_event_slots(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  label text,
  starts_at timestamptz,
  ends_at timestamptz,
  is_enabled boolean,
  sort_order integer,
  reservation_status text,
  walkin_status text,
  reservation_starts_at timestamptz,
  reservation_ends_at timestamptz,
  ticket_use_starts_at timestamptz,
  ticket_use_ends_at timestamptz,
  walkin_starts_at timestamptz,
  walkin_ends_at timestamptz,
  is_reservation_enabled boolean,
  is_ticket_use_enabled boolean,
  is_walkin_enabled boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    es.id, es.label, es.starts_at, es.ends_at, es.is_enabled, es.sort_order,
    calculate_slot_status(
      es.is_enabled, es.is_reservation_enabled, es.reservation_starts_at, es.reservation_ends_at,
      es.reservation_capacity, 
      (COALESCE(res.res_count, 0) + COALESCE(pre.pre_res_count, 0))::bigint,
      COALESCE(es.low_remaining_threshold, e.low_remaining_threshold, 10),
      COALESCE(es.low_remaining_threshold_type, e.low_remaining_threshold_type, 'count'),
      'reservation', e.is_reservation_suspended, e.auto_suspend_at
    ) AS reservation_status,
    calculate_slot_status(
      es.is_enabled, es.is_walkin_enabled, es.walkin_starts_at, es.walkin_ends_at,
      es.total_capacity, 
      (COALESCE(res.res_count, 0) + COALESCE(pre.pre_res_count, 0) + COALESCE(res.walk_count, 0) + COALESCE(pre.pre_walk_count, 0))::bigint,
      COALESCE(es.low_remaining_threshold, e.low_remaining_threshold, 10),
      COALESCE(es.low_remaining_threshold_type, e.low_remaining_threshold_type, 'count'),
      'walkin', e.is_walkin_suspended, e.auto_suspend_at
    ) AS walkin_status,
    es.reservation_starts_at, es.reservation_ends_at, es.ticket_use_starts_at, es.ticket_use_ends_at,
    es.walkin_starts_at, es.walkin_ends_at, es.is_reservation_enabled, es.is_ticket_use_enabled, es.is_walkin_enabled
  FROM event_slots es
  JOIN events e ON es.event_id = e.id
  LEFT JOIN (
    SELECT event_slot_id,
      count(*) FILTER (WHERE status IN ('reserved', 'used') AND ticket_type = 'reservation') AS res_count,
      count(*) FILTER (WHERE status IN ('reserved', 'used') AND ticket_type = 'walkin') AS walk_count
    FROM reservations GROUP BY event_slot_id
  ) res ON es.id = res.event_slot_id
  LEFT JOIN (
    SELECT event_slot_id,
      count(*) FILTER (WHERE status IN ('reserved', 'active', 'activation_failed') AND ticket_type = 'reservation') AS pre_res_count,
      count(*) FILTER (WHERE status IN ('reserved', 'active', 'activation_failed') AND ticket_type = 'walkin') AS pre_walk_count
    FROM admin_pre_registrations GROUP BY event_slot_id
  ) pre ON es.id = pre.event_slot_id
  WHERE es.event_id = p_event_id AND (e.auto_hide_at IS NULL OR now() < e.auto_hide_at);
END;
$$;

-- Public get_public_events
CREATE OR REPLACE FUNCTION get_public_events()
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
            es.reservation_capacity, (COALESCE(r_counts.res_count, 0) + COALESCE(p_counts.pre_res_count, 0))::bigint,
            COALESCE(es.low_remaining_threshold, e.low_remaining_threshold, 10),
            COALESCE(es.low_remaining_threshold_type, e.low_remaining_threshold_type, 'count'),
            'reservation', e.is_reservation_suspended, e.auto_suspend_at
          ),
          'walkin_status', calculate_slot_status(
            es.is_enabled, es.is_walkin_enabled, es.walkin_starts_at, es.walkin_ends_at,
            es.total_capacity, (COALESCE(r_counts.res_count, 0) + COALESCE(p_counts.pre_res_count, 0) + COALESCE(r_counts.walk_count, 0) + COALESCE(p_counts.pre_walk_count, 0))::bigint,
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
