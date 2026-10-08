-- The templates' Auto-send switches are now the one source for the expiry days and birthday wishes
-- the rule engine sends. Carry over what each gym had under Settings › Reminders (default 7, 3, 1
-- and on-the-day, birthdays on), so nothing starts or stops sending because of this change.
UPDATE "WhatsAppTemplate" t
SET "autoSend" = COALESCE(
  (SELECT (s.value -> 'expiryDays') @> to_jsonb(t."ruleDays") FROM "Setting" s WHERE s."orgId" = t."orgId" AND s.key = 'reminders' AND jsonb_typeof(s.value -> 'expiryDays') = 'array'),
  t."ruleDays" IN (7, 3, 1))
WHERE t."ruleWhen" = 'before_expiry' AND t."key" IN ('exp15', 'exp7', 'exp3', 'exp1');

UPDATE "WhatsAppTemplate" t
SET "autoSend" = COALESCE(
  (SELECT (s.value -> 'expiryDays') @> '0'::jsonb FROM "Setting" s WHERE s."orgId" = t."orgId" AND s.key = 'reminders' AND jsonb_typeof(s.value -> 'expiryDays') = 'array'),
  true)
WHERE t."key" = 'expired';

UPDATE "WhatsAppTemplate" t
SET "autoSend" = COALESCE(
  (SELECT (s.value ->> 'birthdays')::boolean FROM "Setting" s WHERE s."orgId" = t."orgId" AND s.key = 'reminders' AND jsonb_typeof(s.value -> 'birthdays') = 'boolean'),
  t."autoSend")
WHERE t."key" = 'birthday';
