-- Provider advisor identified PUBLIC execution on an event-trigger definer.
-- Event triggers do not require client-callable EXECUTE. Preserve its definition,
-- owner, event binding and all other functions; do not open intentional RLS tables.
DO $guard$
BEGIN
 IF to_regprocedure('public.rls_auto_enable()') IS NULL
 OR (SELECT prorettype FROM pg_proc WHERE oid='public.rls_auto_enable()'::regprocedure)<>'event_trigger'::regtype
 THEN RAISE EXCEPTION 'Expected event-trigger function not found; stop for review'; END IF;
END;
$guard$;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
