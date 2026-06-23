-- Track the outcome of the Square fee charge attempt on loan_applications.
-- Allowed values: 'charged' | 'declined' | 'uncollected' (null = not yet attempted).
-- fee_charged_at remains the authoritative "money collected" timestamp; this column
-- captures the most-recent charge attempt result so staff can triage uncollected fees.
-- Idempotent: safe to re-run.

alter table loan_applications
  add column if not exists fee_charge_status text
    check (fee_charge_status is null or fee_charge_status in ('charged', 'declined', 'uncollected'));
