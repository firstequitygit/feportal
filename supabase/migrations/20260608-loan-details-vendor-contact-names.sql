-- Contact-person name for each vendor type. Sits next to the
-- existing Title / Insurance / Appraiser company columns in the
-- Vendors section of the Loan Details card. Synced bidirectionally
-- with the "Name" column on each Airtable vendor table (Title,
-- Insurance, Appraisers).
--
-- Primary-record selection: when a deal has multiple vendor records
-- linked (e.g., Edgardo Mercado's two Title Contacts), the sync
-- looks for a "Primary" boolean column on the vendor row and pulls
-- from whichever is marked primary. Falls back to the first-linked
-- record when no Primary column / no record is marked, so existing
-- behavior is preserved until the schema change lands on the
-- Airtable side.

alter table loan_details
  add column if not exists title_contact_name      text,
  add column if not exists insurance_contact_name  text,
  add column if not exists appraisal_contact_name  text;
