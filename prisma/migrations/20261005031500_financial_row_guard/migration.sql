-- Financial records are kept. Nothing in the app deletes an invoice, payment, expense or the like: a mistake is
-- voided or reversed, so the books keep both. This makes the database say no to a DELETE (or TRUNCATE) of one,
-- whoever asks: a bug in some future code path, a query typed into a SQL prompt, a cascade from a parent row.
-- The audit log can be neither changed nor deleted.
--
-- Two operations remove money records on purpose, and say so inside their own transaction
-- (src/lib/services/db-guard.ts, set_config('fitron.allow_delete', ..., true), which ends with the transaction):
--   'demo-clear'  Go live > Clear demo data. Only for rows of a gym flagged "demo" (Organization.demo), checked here.
--   'restore'     Settings > Backup > Restore from file, which replaces one gym's rows with the file's.
-- This does not stop someone with the database owner's password from dropping the triggers; it stops mistakes.

CREATE FUNCTION fitron_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  why  text := current_setting('fitron.allow_delete', true);
  org  text;
  demo boolean;
BEGIN
  IF why = 'restore' THEN
    RETURN OLD;
  END IF;
  IF why = 'demo-clear' THEN
    -- Which gym does this row belong to? Some tables hold it themselves, the rest through their parent.
    org := CASE TG_TABLE_NAME
      WHEN 'InvoiceItem'   THEN (SELECT i."orgId" FROM "Invoice" i  WHERE i.id = to_jsonb(OLD) ->> 'invoiceId')
      WHEN 'Membership'    THEN (SELECT m."orgId" FROM "Member" m   WHERE m.id = to_jsonb(OLD) ->> 'memberId')
      WHEN 'PurchaseLine'  THEN (SELECT p."orgId" FROM "Purchase" p WHERE p.id = to_jsonb(OLD) ->> 'purchaseId')
      WHEN 'VendorPayment' THEN (SELECT p."orgId" FROM "Purchase" p WHERE p.id = to_jsonb(OLD) ->> 'purchaseId')
      ELSE to_jsonb(OLD) ->> 'orgId'
    END;
    SELECT o.demo INTO demo FROM "Organization" o WHERE o.id = org;
    IF demo IS TRUE THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'Deleting a % record is not allowed: financial records are kept.', TG_TABLE_NAME
    USING HINT = 'Void or reverse it in the app instead. Only "Clear demo data" on a demo gym and "Restore from backup" may delete these.';
END
$$;

CREATE FUNCTION fitron_never_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Deleting a % record is not allowed: financial records are kept.', TG_TABLE_NAME;
END
$$;

CREATE FUNCTION fitron_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'The audit log is append-only: a row cannot be changed or removed.';
END
$$;

CREATE FUNCTION fitron_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Emptying the % table is not allowed: financial records are kept.', TG_TABLE_NAME;
END
$$;

-- Gym money: kept, except by "Clear demo data" on a demo gym and "Restore from backup".
CREATE TRIGGER fitron_guard_delete BEFORE DELETE ON "Invoice"       FOR EACH ROW EXECUTE FUNCTION fitron_guard_delete();
CREATE TRIGGER fitron_guard_delete BEFORE DELETE ON "InvoiceItem"   FOR EACH ROW EXECUTE FUNCTION fitron_guard_delete();
CREATE TRIGGER fitron_guard_delete BEFORE DELETE ON "Payment"       FOR EACH ROW EXECUTE FUNCTION fitron_guard_delete();
CREATE TRIGGER fitron_guard_delete BEFORE DELETE ON "Membership"    FOR EACH ROW EXECUTE FUNCTION fitron_guard_delete();
CREATE TRIGGER fitron_guard_delete BEFORE DELETE ON "Expense"       FOR EACH ROW EXECUTE FUNCTION fitron_guard_delete();
CREATE TRIGGER fitron_guard_delete BEFORE DELETE ON "Purchase"      FOR EACH ROW EXECUTE FUNCTION fitron_guard_delete();
CREATE TRIGGER fitron_guard_delete BEFORE DELETE ON "PurchaseLine"  FOR EACH ROW EXECUTE FUNCTION fitron_guard_delete();
CREATE TRIGGER fitron_guard_delete BEFORE DELETE ON "VendorPayment" FOR EACH ROW EXECUTE FUNCTION fitron_guard_delete();
CREATE TRIGGER fitron_guard_delete BEFORE DELETE ON "Asset"         FOR EACH ROW EXECUTE FUNCTION fitron_guard_delete();
-- The invoice number counter: a deleted one would start numbering again from 1.
CREATE TRIGGER fitron_guard_delete BEFORE DELETE ON "Sequence"      FOR EACH ROW EXECUTE FUNCTION fitron_guard_delete();

-- Never deleted by anything: staff pay, a gym's FITRON subscription payments, AI Trainer payments.
CREATE TRIGGER fitron_never_delete BEFORE DELETE ON "SalaryPayment"     FOR EACH ROW EXECUTE FUNCTION fitron_never_delete();
CREATE TRIGGER fitron_never_delete BEFORE DELETE ON "BranchSubscription" FOR EACH ROW EXECUTE FUNCTION fitron_never_delete();
CREATE TRIGGER fitron_never_delete BEFORE DELETE ON "TrainerPayment"    FOR EACH ROW EXECUTE FUNCTION fitron_never_delete();

-- The audit log: add to it, never change it.
CREATE TRIGGER fitron_audit_append_only BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION fitron_audit_append_only();

-- TRUNCATE does not run row triggers, so it is refused on its own.
CREATE TRIGGER fitron_no_truncate BEFORE TRUNCATE ON "Invoice"           FOR EACH STATEMENT EXECUTE FUNCTION fitron_no_truncate();
CREATE TRIGGER fitron_no_truncate BEFORE TRUNCATE ON "InvoiceItem"       FOR EACH STATEMENT EXECUTE FUNCTION fitron_no_truncate();
CREATE TRIGGER fitron_no_truncate BEFORE TRUNCATE ON "Payment"           FOR EACH STATEMENT EXECUTE FUNCTION fitron_no_truncate();
CREATE TRIGGER fitron_no_truncate BEFORE TRUNCATE ON "Membership"        FOR EACH STATEMENT EXECUTE FUNCTION fitron_no_truncate();
CREATE TRIGGER fitron_no_truncate BEFORE TRUNCATE ON "Expense"           FOR EACH STATEMENT EXECUTE FUNCTION fitron_no_truncate();
CREATE TRIGGER fitron_no_truncate BEFORE TRUNCATE ON "Purchase"          FOR EACH STATEMENT EXECUTE FUNCTION fitron_no_truncate();
CREATE TRIGGER fitron_no_truncate BEFORE TRUNCATE ON "PurchaseLine"      FOR EACH STATEMENT EXECUTE FUNCTION fitron_no_truncate();
CREATE TRIGGER fitron_no_truncate BEFORE TRUNCATE ON "VendorPayment"     FOR EACH STATEMENT EXECUTE FUNCTION fitron_no_truncate();
CREATE TRIGGER fitron_no_truncate BEFORE TRUNCATE ON "Asset"             FOR EACH STATEMENT EXECUTE FUNCTION fitron_no_truncate();
CREATE TRIGGER fitron_no_truncate BEFORE TRUNCATE ON "Sequence"          FOR EACH STATEMENT EXECUTE FUNCTION fitron_no_truncate();
CREATE TRIGGER fitron_no_truncate BEFORE TRUNCATE ON "SalaryPayment"     FOR EACH STATEMENT EXECUTE FUNCTION fitron_no_truncate();
CREATE TRIGGER fitron_no_truncate BEFORE TRUNCATE ON "BranchSubscription" FOR EACH STATEMENT EXECUTE FUNCTION fitron_no_truncate();
CREATE TRIGGER fitron_no_truncate BEFORE TRUNCATE ON "TrainerPayment"    FOR EACH STATEMENT EXECUTE FUNCTION fitron_no_truncate();
CREATE TRIGGER fitron_no_truncate BEFORE TRUNCATE ON "AuditLog"          FOR EACH STATEMENT EXECUTE FUNCTION fitron_no_truncate();
