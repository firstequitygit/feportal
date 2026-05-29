-- Split the single "Staff Notes" section into four labeled buckets:
-- Loan Officer, Processor, Underwriter, Closer.
--
-- Anyone with access to the loan can post in any category (same access
-- model as today). The category is just an organizational label so the
-- UI can render four separate sub-sections.
--
-- Existing notes default to 'loan_officer' per product call — they
-- continue to render under "Loan Officer Notes" after the deploy.

alter table loan_notes
  add column if not exists category text not null default 'loan_officer';

-- Constrain to the four supported buckets. Anything else would render in
-- no section and silently disappear from the UI, so reject at the DB.
alter table loan_notes
  drop constraint if exists loan_notes_category_check;

alter table loan_notes
  add constraint loan_notes_category_check
  check (category in ('loan_officer', 'processor', 'underwriter', 'closer'));
