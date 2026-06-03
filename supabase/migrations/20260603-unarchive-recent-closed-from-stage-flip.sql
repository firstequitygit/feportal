-- Backfill for /api/loans/stage previously archiving loans the moment
-- staff moved them to "Closed", instead of waiting for the 30-day
-- auto-archive cron. Symptom: a loan closed yesterday (e.g. 1023 Monroe
-- Ave on 2026-06-02) would not appear under the Closed bucket on the
-- LO loans page because the page filters archived loans out.
--
-- This un-archives any loan that:
--   - is currently archived
--   - is in pipeline_stage = 'Closed'
--   - is not cancelled (loan_status != 'cancelled' — those stay archived)
--   - closed within the last 30 days
--
-- Safe to re-run; the WHERE clause filters by archived=true so a second
-- run is a no-op. The auto-archive cron will pick these back up at the
-- 30-day mark per normal policy.

update loans
   set archived = false
 where archived = true
   and pipeline_stage = 'Closed'
   and (loan_status is null or loan_status <> 'cancelled')
   and closed_at is not null
   and closed_at >= now() - interval '30 days';
