-- Track per-loan Airtable sync timestamp so the hourly cron can process
-- the staleness incrementally — pick the oldest-synced N loans each run,
-- update the timestamp, and rotate through the full base over ~2 days.
--
-- NULL means "never synced" — those float to the top of the ordering so
-- the cron picks them up first. NULL is also the default for new loans
-- created by the existing Pipedrive sync.

alter table loans
  add column if not exists airtable_last_synced_at timestamptz;

-- Cheap ascending index — the cron picks oldest first.
create index if not exists loans_airtable_last_synced_at_idx
  on loans (airtable_last_synced_at nulls first);
