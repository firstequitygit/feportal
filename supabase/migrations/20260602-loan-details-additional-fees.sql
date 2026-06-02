-- New Loan Terms fee fields paired with Underwriting Fee / Legal-Doc Prep Fee
-- on the Vesting/Loan Details card.
--
-- Three of these mirror Airtable values (Desk Review Fee + Small Balance Fee
-- are Airtable formula fields; Feasibility Fee is a writable currency field).
-- Additional Fees is a portal-driven bucket that staff fill in to capture
-- fees Airtable doesn't track individually (Flood Cert Fee, COGS Fee, Credit
-- Rescore Fee, Other). additional_fees_notes is portal-only — a freeform
-- description of what the dollar total represents.
--
-- All numeric so totals can be summed downstream if needed.

alter table loan_details
  add column if not exists desk_review_fee      numeric,
  add column if not exists small_balance_fee    numeric,
  add column if not exists feasibility_fee      numeric,
  add column if not exists additional_fees      numeric,
  add column if not exists additional_fees_notes text;
