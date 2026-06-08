-- Appraisal Order Date — captures when the appraisal was ordered
-- from the vendor. Sits at the top of the Appraisal / Review Tracking
-- section on the Loan Details card, before the existing Paid /
-- Received / Effective dates (which all come later in the workflow).
--
-- Bidirectional Airtable sync to "Appraisal Order Date". No
-- Pipedrive equivalent.

alter table loan_details
  add column if not exists appraisal_order_date date;
