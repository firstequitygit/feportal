-- Rate Lock Date — captures when the rate was locked. Sits next to
-- the existing rate_lock_expiration_date on the loans table and
-- syncs bidirectionally with Airtable's "DSCR Lock Date" column.
-- No Pipedrive equivalent.

alter table loans
  add column if not exists rate_lock_date date;
