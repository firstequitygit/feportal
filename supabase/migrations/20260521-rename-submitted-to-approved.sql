-- Rename portal pipeline stage 'Submitted' → 'Approved' AND register the
-- new 'Conditionally Approved' stage.
--
-- Pipedrive and Airtable keep their existing labels (Submitted /
-- Underwriting). The PIPEDRIVE_STAGE_MAP in src/lib/types.ts translates
-- Pipedrive's stage id 14 ('Submitted') → 'Approved' going forward.
--
-- Two tables hold the stage string:
--   loans.pipeline_stage           — current stage of each loan
--   loan_stage_history.stage       — timeline of stage transitions
--
-- loans.pipeline_stage has a CHECK constraint pinning it to the old set
-- of values. Order matters: drop first, rename the rows, THEN add the
-- new constraint (so it validates against already-clean data).

-- 1. Drop the old constraint so the UPDATE isn't blocked
alter table loans drop constraint if exists loans_pipeline_stage_check;

-- 2. Rename the rows
update loans
set pipeline_stage = 'Approved'
where pipeline_stage = 'Submitted';

update loan_stage_history
set stage = 'Approved'
where stage = 'Submitted';

-- 3. Add the new constraint with the full current stage set
alter table loans add constraint loans_pipeline_stage_check
  check (pipeline_stage in (
    'New Application',
    'Processing',
    'Pre-Underwriting',
    'Underwriting',
    'Conditionally Approved',
    'Approved',
    'Closed'
  ));
