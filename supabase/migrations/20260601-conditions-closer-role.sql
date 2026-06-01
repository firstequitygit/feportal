-- Add 'closer' as a valid assigned_to value for conditions + templates.
--
-- "Closer" isn't a separate role table at FE today — Omayra Cartagena
-- (loan_processors.email = 'ocartagena@fefunding.com') handles closing
-- on every loan, so the application layer routes Closer-assigned emails
-- directly to her. Adding a dedicated bucket here lets staff explicitly
-- hand conditions off "to the closer" without dropping them in the
-- general Loan Processor queue.
--
-- Idempotent — drops the constraint and re-creates with the expanded list.

alter table conditions drop constraint if exists conditions_assigned_to_check;
alter table conditions add  constraint conditions_assigned_to_check
  check (assigned_to in ('borrower', 'loan_officer', 'loan_processor', 'underwriter', 'closer'));

alter table condition_templates drop constraint if exists condition_templates_assigned_to_check;
alter table condition_templates add  constraint condition_templates_assigned_to_check
  check (assigned_to in ('borrower', 'loan_officer', 'loan_processor', 'underwriter', 'closer'));
