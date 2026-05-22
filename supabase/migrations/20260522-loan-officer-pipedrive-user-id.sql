-- Map Loan Officers to Pipedrive users so the deal owner from Pipedrive
-- drives portal LO assignment.
--
-- Each Pipedrive user has a numeric `user_id`. Setting that value on the
-- corresponding loan_officers row lets the sync routes (/api/cron/sync,
-- /api/sync, /api/webhooks/pipedrive) auto-assign loan_officer_id to the
-- matching portal LO whenever a deal is created or updated.
--
-- Unique constraint prevents two LOs from sharing the same Pipedrive user
-- (would create ambiguous sync results).

alter table loan_officers
  add column if not exists pipedrive_user_id integer;

create unique index if not exists loan_officers_pipedrive_user_id_unique_idx
  on loan_officers (pipedrive_user_id)
  where pipedrive_user_id is not null;
