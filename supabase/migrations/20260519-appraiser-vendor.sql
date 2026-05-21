-- Appraiser vendor — mirrors the title / insurance vendor columns on
-- loan_details so the Vendors page can surface all three types.

alter table loan_details add column if not exists appraisal_company text;
alter table loan_details add column if not exists appraisal_email   text;
alter table loan_details add column if not exists appraisal_phone   text;
