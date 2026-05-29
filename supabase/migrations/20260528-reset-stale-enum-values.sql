-- Reset Pipedrive enum option ids that leaked into loans.interest_only
-- as raw numeric strings (e.g. "270") instead of "Yes" / "No". The sync
-- routes now resolve enum ids to labels via the Pipedrive dealFields API,
-- but historical rows still carry the unmapped value.
--
-- Only Interest Only is fixed here — it's strictly a Yes/No enum so any
-- purely numeric value is definitely a leaked option id. Other enum
-- columns (rate_locked_days, loan_type_ii) intentionally untouched
-- because their labels could plausibly be numeric ("30").
--
-- The next sync run (manual Sync Pipedrive button, webhook on the next
-- deal update, or the daily cron) will repopulate with the correct label.

update loans
set interest_only = null
where interest_only ~ '^[0-9]+$';
