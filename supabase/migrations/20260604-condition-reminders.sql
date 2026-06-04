-- Track when we last sent an outstanding-conditions reminder to a
-- given party (borrower vs broker) on each loan. Used by both the
-- manual "Send Reminder" button on the loan header and the daily
-- auto-cron that re-nudges every 3 weekdays.
--
-- One row per loan, two columns — we don't need a full history table
-- yet, just the most recent send timestamp so the 3-day cadence can
-- gate the next auto-send. Manual sends overwrite the timestamp too,
-- so the cron resets its 3-day window any time a human nudges.

alter table loans
  add column if not exists last_borrower_reminder_at timestamptz,
  add column if not exists last_broker_reminder_at   timestamptz;
