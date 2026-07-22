-- Multi-day events must use the earliest slot start and latest slot end.
-- A NULL walkin_limit means the walk-in capacity is dynamic and constrained
-- only by the slot's remaining total capacity.

CREATE OR REPLACE FUNCTION public.sync_event_bounds_from_slots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  v_event_id := COALESCE(NEW.event_id, OLD.event_id);

  UPDATE public.events e
  SET
    starts_at = bounds.min_starts_at,
    ends_at = bounds.max_ends_at,
    updated_at = now()
  FROM (
    SELECT
      MIN(es.starts_at) AS min_starts_at,
      MAX(es.ends_at) AS max_ends_at
    FROM public.event_slots es
    WHERE es.event_id = v_event_id
  ) bounds
  WHERE e.id = v_event_id
    AND bounds.min_starts_at IS NOT NULL
    AND bounds.max_ends_at IS NOT NULL;

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_event_bounds_from_slots() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_event_bounds_from_slots() FROM anon;
REVOKE ALL ON FUNCTION public.sync_event_bounds_from_slots() FROM authenticated;

DROP TRIGGER IF EXISTS sync_event_bounds_after_slot_change ON public.event_slots;
CREATE TRIGGER sync_event_bounds_after_slot_change
AFTER INSERT OR UPDATE OF starts_at, ends_at, event_id OR DELETE
ON public.event_slots
FOR EACH ROW
EXECUTE FUNCTION public.sync_event_bounds_from_slots();

-- Repair all existing parent event ranges from their slots.
UPDATE public.events e
SET
  starts_at = bounds.min_starts_at,
  ends_at = bounds.max_ends_at,
  updated_at = now()
FROM (
  SELECT
    event_id,
    MIN(starts_at) AS min_starts_at,
    MAX(ends_at) AS max_ends_at
  FROM public.event_slots
  GROUP BY event_id
) bounds
WHERE e.id = bounds.event_id
  AND bounds.min_starts_at IS NOT NULL
  AND bounds.max_ends_at IS NOT NULL;

-- Existing multi-day events that accidentally stored a calculated walk-in
-- remainder as a fixed limit are restored to dynamic capacity mode.
UPDATE public.event_slots es
SET walkin_limit = NULL
FROM public.events e
WHERE es.event_id = e.id
  AND e.title = '夏の100円学食';
