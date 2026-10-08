-- Row-level security on every table.
--
-- Supabase (and anything else that serves a schema over an API) lets its public roles, "anon" and "authenticated",
-- read and write every table in `public` that has no row-level security. Fitron holds members, invoices and payments,
-- so none of it may be reachable that way. Fitron itself connects as the table owner, which row-level security does
-- not apply to, so switching it on changes nothing for the app. With no policies it only closes that door.
--
-- A plain Postgres has no such roles, and this is harmless there. Only tables this role owns are touched, so tables
-- that belong to an extension are left alone. Safe to run again.
--
-- A table added by a later migration needs the same line: ALTER TABLE "Name" ENABLE ROW LEVEL SECURITY;
-- (src/lib/services/rls.db.test.ts fails when one is missed).
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;
