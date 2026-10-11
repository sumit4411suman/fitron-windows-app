-- Members brought in by the member import were dated the day of the import, so the dashboard counted every one of them
-- as a new member that day. Their join date is now the start of their first migrated plan (the import does this itself
-- from now on, or takes a "Joined on" column). Only members with a migrated plan that started before they were added
-- are touched. Safe to run again.
UPDATE "Member" m
SET "createdAt" = first_plan.start
FROM (
  SELECT "memberId", MIN("startDate")::timestamp AT TIME ZONE 'UTC' AS start
  FROM "Membership"
  WHERE "type" = 'IMPORT'
  GROUP BY "memberId"
) first_plan
WHERE first_plan."memberId" = m."id"
  AND first_plan.start < m."createdAt";
