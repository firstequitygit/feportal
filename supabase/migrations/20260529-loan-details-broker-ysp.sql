-- Broker YSP (Yield Spread Premium). New Loan Terms field on the Vesting/
-- Loan Details card, paired with the existing Broker Points field.
--
-- Stored as a percentage value the way Points / Broker Points are
-- (numeric, e.g. 1 means 1%). The Airtable mapping in airtable-field-map.ts
-- converts to the fraction form Airtable expects (0.01) via pointsForward.

alter table loan_details
  add column if not exists broker_ysp numeric;
