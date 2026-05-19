-- Loan Application intake (Supabase-native; replaces JotForm path).
-- Idempotent: safe to re-run.

-- 1. App-created loans have no Pipedrive deal — allow NULL.
alter table loans alter column pipedrive_deal_id drop not null;

-- 2. Draft/intake table. `data` jsonb holds the entire form while draft.
create table if not exists loan_applications (
  id uuid primary key default uuid_generate_v4(),
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  current_step int not null default 1 check (current_step between 1 and 6),
  resume_token uuid not null default uuid_generate_v4(),
  resume_email text,
  data jsonb not null default '{}'::jsonb,
  square_customer_id text,
  square_card_id text,
  card_brand text,
  card_last4 text,
  fee_amount_cents int,
  fee_charged_at timestamptz,
  submitted_loan_id uuid references loans(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists loan_applications_resume_token_idx
  on loan_applications(resume_token);
create index if not exists loan_applications_status_idx
  on loan_applications(status);
create index if not exists loan_applications_submitted_loan_idx
  on loan_applications(submitted_loan_id);

-- 3. RLS: anon fully denied; only service-role (createAdminClient) touches it.
alter table loan_applications enable row level security;
-- (no policies = default deny for anon/authenticated)

-- 4. updated_at trigger (reuses existing function).
drop trigger if exists update_loan_applications_updated_at on loan_applications;
create trigger update_loan_applications_updated_at
  before update on loan_applications
  for each row execute function update_updated_at_column();
