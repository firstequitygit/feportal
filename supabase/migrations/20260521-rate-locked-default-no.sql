-- Default `loans.rate_locked_days` to 'No' so the typical state of a loan
-- (rate not yet locked) is reflected in the UI without an LO having to
-- manually set it. The portal's editable enum was already
--   { 'No', '15 days', '30 days', '45 days' }
-- but the column had no default, so existing rows show "—".
--
-- Two parts:
--   1. Backfill every NULL to 'No' for consistency
--   2. Set a column default so future inserts (Pipedrive sync, Jotform
--      intake) start at 'No'

update loans set rate_locked_days = 'No' where rate_locked_days is null;

alter table loans alter column rate_locked_days set default 'No';
