-- Default Underwriting Fee + Legal/Doc Prep Fee on the Loan Terms
-- section of the Loan Details card. Standard product pricing — every
-- new loan starts at $1,695 / $995 unless staff overrides.
--
-- Backfill only NULL rows so any value already on the books (incl.
-- a deliberate $0) survives untouched. New loan_details rows
-- inserted without these columns now land on the defaults
-- automatically; staff can still edit either field to any value.
--
-- Neither field syncs to Pipedrive or Airtable, so the backfill
-- can't leak the default value into the source systems.

alter table loan_details
  alter column underwriting_fee   set default 1695,
  alter column legal_doc_prep_fee set default 995;

update loan_details
  set underwriting_fee = 1695
  where underwriting_fee is null;

update loan_details
  set legal_doc_prep_fee = 995
  where legal_doc_prep_fee is null;
