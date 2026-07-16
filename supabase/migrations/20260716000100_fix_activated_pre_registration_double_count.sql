BEGIN;

-- Pre-registration rows with status = 'active' have already been converted into
-- reservations. Counting both rows double-counted the same participant and could
-- show a remaining seat while the reservation RPC rejected it as full.
-- 'activation_failed' rows must not reserve capacity either.
DO $$
DECLARE
  v_oid oid;
  v_definition text;
BEGIN
  FOR v_oid IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname IN (
        'create_reservation',
        'create_reservations_bulk',
        'create_walkin_reservation',
        'get_public_events',
        'admin_create_pre_registration',
        'admin_get_event_slots'
      )
  LOOP
    v_definition := pg_get_functiondef(v_oid);
    v_definition := replace(
      v_definition,
      'status IN (''reserved'',''active'',''activation_failed'')',
      'status = ''reserved'''
    );
    v_definition := replace(
      v_definition,
      'status IN (''reserved'', ''active'', ''activation_failed'')',
      'status = ''reserved'''
    );
    EXECUTE v_definition;
  END LOOP;
END;
$$;

COMMIT;
