-- Urgency flag for conditions. When set, the loan's underwriter gets
-- emailed the moment the condition status flips into 'Received', so
-- they can pick it up immediately rather than waiting for their next
-- inbox check.
--
-- Default false. Any staff with loan access (admin / LO / LP / UW) can
-- toggle; permission check lives in /api/conditions/urgency.

alter table conditions
  add column if not exists is_urgent boolean not null default false;
