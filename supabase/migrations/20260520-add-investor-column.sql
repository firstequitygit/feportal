-- Add `investor` to loan_details. Mirrors the "Investor" singleSelect on the
-- Airtable Deals table so the bidirectional sync can keep them in lockstep.
-- Stored as text (the API whitelist validates against the known choices).

alter table loan_details
  add column if not exists investor text;
