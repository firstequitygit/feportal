-- Appraisal Due Date — vendor's commitment for when the appraisal
-- will land. Sits in the Appraisal / Review Tracking section
-- between Order Date (when WE placed the order) and Paid Date
-- (when WE paid the invoice).
--
-- Bidirectional Airtable sync to "Due Date" on the Deals base.
-- No Pipedrive equivalent.

alter table loan_details
  add column if not exists appraisal_due_date date;
