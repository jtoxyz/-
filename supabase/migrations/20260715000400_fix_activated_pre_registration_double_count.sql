DO $$
DECLARE
  fn_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO fn_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_event_slots'
  LIMIT 1;

  IF fn_def IS NULL THEN
    RAISE EXCEPTION 'public.get_event_slots(uuid) was not found';
  END IF;

  fn_def := replace(
    fn_def,
    'status IN (''reserved'', ''active'', ''activation_failed'') AND ticket_type = ''reservation''',
    'status IN (''reserved'', ''activation_failed'') AND ticket_type = ''reservation'''
  );

  fn_def := replace(
    fn_def,
    'status IN (''reserved'', ''active'', ''activation_failed'') AND ticket_type = ''walkin''',
    'status IN (''reserved'', ''activation_failed'') AND ticket_type = ''walkin'''
  );

  EXECUTE fn_def;
END;
$$;
