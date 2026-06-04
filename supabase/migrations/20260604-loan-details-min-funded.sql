-- Two new fields on the Loan / Deal Overview section of the Loan
-- Details card:
--
--   min_number   text   ↔ Airtable "Min #"           (Single line text)
--   funded_date  date   ↔ Airtable "Funding Date"    (Date)
--
-- Origination Date and Maturity Date stay on the loans table where
-- they already live (they sync with Pipedrive too); the UI just
-- moves them out of Loan Summary into Loan / Deal Overview.

alter table loan_details
  add column if not exists min_number  text,
  add column if not exists funded_date date;
