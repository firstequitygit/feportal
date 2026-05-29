-- Backfill for the Pipedrive webhook bug that archived every won deal
-- the instant Pipedrive flipped status='won', instead of waiting for the
-- 30-day auto-archive cron. Symptom: LO loan list showed only a fraction
-- of recently-closed loans (the ones the webhook somehow missed).
--
-- Policy after the webhook fix: a won deal stays archived=false until
-- it has been in 'Closed' for 30 days, at which point /api/cron/auto-archive
-- archives it.
--
-- This backfill un-archives any loan that:
--   - is in pipeline_stage = 'Closed'
--   - is not cancelled (loan_status != 'cancelled') — those should stay archived
--   - closed within the last 30 days
--   - was archived (presumably by the buggy webhook)
--
-- Safe to re-run; the WHERE clause filters by archived=true so a second
-- run is a no-op.

update loans
   set archived = false
 where archived = true
   and pipeline_stage = 'Closed'
   and (loan_status is null or loan_status <> 'cancelled')
   and closed_at is not null
   and closed_at >= now() - interval '30 days';
