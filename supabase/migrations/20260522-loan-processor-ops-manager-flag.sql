-- Adds an "ops manager" flag to loan_processors. Ops managers (currently
-- Omayra) help LPs and UWs across the whole pipeline and need to be able
-- to open any loan, not just ones they're directly assigned to.
--
-- The flag is read by the /loan-processor/* pages and the
-- /api/loan-processor/* routes — when true, the assignment filter is
-- skipped and every active/archived loan is visible / mutable.

alter table loan_processors
  add column if not exists is_ops_manager boolean not null default false;

-- Flip Omayra's flag on by email. Idempotent — only updates the matching
-- row, no-op if her row doesn't exist yet.
update loan_processors
set is_ops_manager = true
where email = 'ocartagena@fefunding.com';
