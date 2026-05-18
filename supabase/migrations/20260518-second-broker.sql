-- Second broker slot — the broker's own processor or co-broker.
-- Both slots get portal access and both receive borrower-side
-- notifications. Same brokers table, no new role.

alter table loans add column if not exists broker_id_2 uuid
  references brokers(id) on delete set null;
create index if not exists idx_loans_broker_id_2 on loans(broker_id_2);
