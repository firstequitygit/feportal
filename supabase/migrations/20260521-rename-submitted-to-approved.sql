-- Rename portal pipeline stage 'Submitted' → 'Approved'.
--
-- Pipedrive and Airtable keep their existing label ('Submitted'). The
-- PIPEDRIVE_STAGE_MAP in src/lib/types.ts translates Pipedrive's
-- stage id 14 ('Submitted') → 'Approved' going forward, so future syncs
-- write the new label into the portal automatically.
--
-- Two tables hold the stage string:
--   loans.pipeline_stage           — current stage of each loan
--   loan_stage_history.stage       — timeline of stage transitions
-- Both need the rename so existing rows display the new label.

update loans
set pipeline_stage = 'Approved'
where pipeline_stage = 'Submitted';

update loan_stage_history
set stage = 'Approved'
where stage = 'Submitted';
