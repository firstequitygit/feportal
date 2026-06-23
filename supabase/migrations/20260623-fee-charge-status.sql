-- Track the outcome of the Square fee charge attempt on loan_applications.
-- Allowed values: 'charging' | 'charged' | 'declined' | 'needs_review' (null = not yet attempted).
--   null          - never attempted
--   charging      - claim held, Square call in flight (transient)
--   charged       - success; fee_charged_at is set (authoritative "money collected")
--   declined      - card declined; retryable
--   needs_review  - hard error / ambiguous / persist-failed-after-success; manual reconciliation
-- fee_charged_at remains the authoritative "money collected" timestamp; this column
-- captures the most-recent charge attempt result so staff can triage uncollected fees.
-- Idempotent: safe to re-run. Drops the prior constraint (which allowed the legacy
-- 'uncollected' value) and re-adds it with the final value set.

alter table loan_applications
  add column if not exists fee_charge_status text;

-- Migrate any legacy 'uncollected' rows to null (never attempted) before re-adding
-- the constraint, so the new constraint validates against clean data.
update loan_applications
  set fee_charge_status = null
  where fee_charge_status = 'uncollected';

alter table loan_applications
  drop constraint if exists loan_applications_fee_charge_status_check;

alter table loan_applications
  add constraint loan_applications_fee_charge_status_check
    check (fee_charge_status is null
      or fee_charge_status in ('charging', 'charged', 'declined', 'needs_review'));
