-- Brokered loans: the portal-facing contact is the broker (with their own
-- login), while the borrower stays in the system for record-keeping.
-- A broker can be on many loans. The loan keeps both a borrower_id and a
-- broker_id; either or both may be null. When broker_id is set, the broker
-- is the notification recipient (see /api/* condition routes).

create table if not exists brokers (
  id uuid primary key default uuid_generate_v4(),
  auth_user_id uuid references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text,
  company_name text,
  phone text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_brokers_auth_user_id on brokers(auth_user_id);
create index if not exists idx_brokers_email        on brokers(email);

alter table loans add column if not exists broker_id uuid references brokers(id) on delete set null;
create index if not exists idx_loans_broker_id on loans(broker_id);
