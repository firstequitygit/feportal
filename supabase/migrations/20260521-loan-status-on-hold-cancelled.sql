-- Add lifecycle status separate from pipeline_stage so we can flag loans
-- as On Hold or Cancelled without losing the original stage context (which
-- stage they died/stalled in is useful for reporting).
--
-- Three statuses:
--   active     — normal flow through pipeline_stage
--   on_hold    — temporarily paused (still in board with a badge)
--   cancelled  — dead deal (auto-archived, mirrored to Pipedrive as Lost)
--
-- cancellation_reason is free-text; we only populate it when status flips
-- to cancelled and clear it on reactivate.

alter table loans
  add column if not exists loan_status text not null default 'active'
    check (loan_status in ('active', 'on_hold', 'cancelled'));

alter table loans
  add column if not exists cancellation_reason text;

alter table loans
  add column if not exists status_changed_at timestamptz;

-- Cheap filter index — most active views will scope by status.
create index if not exists loans_loan_status_idx on loans (loan_status);
