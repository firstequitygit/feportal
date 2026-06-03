-- Add 'Under Review' as a sixth condition status, slotting between
-- Received and Waived in the workflow.
--
-- Display order in the dropdowns:
--   Outstanding · Rejected · Received · Under Review · Waived · Satisfied
--
-- Existing rows untouched. Idempotent: drops the constraint and
-- recreates with the expanded list.

alter table conditions drop constraint if exists conditions_status_check;
alter table conditions add  constraint conditions_status_check
  check (status in ('Outstanding', 'Received', 'Under Review', 'Satisfied', 'Waived', 'Rejected'));
