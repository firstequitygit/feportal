-- Rate Lock Extended (Yes / No) on the Loan Summary card. Lives on
-- the loans table next to rate_locked_days + rate_lock_expiration_date
-- and syncs bidirectionally with the Airtable singleSelect field of
-- the same name. Extension cost amounts continue to live on
-- loan_details (rate_costs_points etc.) — this flag is just the gate.
--
-- Stored as text rather than boolean so it mirrors the Airtable
-- singleSelect's "Yes" / "No" cells without a transform layer
-- (matches the existing interest_only pattern on the same table).

alter table loans
  add column if not exists rate_lock_extended text;
