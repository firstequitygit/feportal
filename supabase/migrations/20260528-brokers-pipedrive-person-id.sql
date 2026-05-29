-- Mirror the borrowers.pipedrive_person_id column on brokers so the sync
-- can identify brokers across Pipedrive ↔ portal even if their email
-- changes. The broker is linked from a Pipedrive deal via a custom
-- "Broker" person field (field key
-- fe46b6b2dbd2155a3ca4a1994f33ab3da3f2b05c).
--
-- Find-or-link priority in broker-sync.ts:
--   1. existing brokers row with the same pipedrive_person_id
--   2. existing brokers row with the same email
--   3. insert a new brokers row

alter table brokers
  add column if not exists pipedrive_person_id integer unique;

create index if not exists idx_brokers_pipedrive_person_id
  on brokers(pipedrive_person_id);
