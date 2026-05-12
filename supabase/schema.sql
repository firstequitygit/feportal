-- ============================================================
-- Desco Financial Borrower Portal — Database Schema
-- Run this entire file in Supabase SQL Editor
-- ============================================================

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ============================================================
-- BORROWERS
-- One row per borrower. Linked to Supabase Auth user.
-- ============================================================
create table if not exists borrowers (
  id uuid primary key default uuid_generate_v4(),
  auth_user_id uuid references auth.users(id) on delete cascade,
  pipedrive_person_id integer unique,
  email text unique not null,
  full_name text,
  entity_name text,
  phone text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- LOANS
-- Synced from Pipedrive deals. Pipedrive is source of truth.
-- ============================================================
create table if not exists loans (
  id uuid primary key default uuid_generate_v4(),
  pipedrive_deal_id integer unique not null,
  borrower_id uuid references borrowers(id) on delete set null,

  -- Property
  property_address text,

  -- Loan details
  loan_type text check (loan_type in ('Bridge', 'Fix & Flip', 'New Construction', 'DSCR')),
  loan_amount numeric(12, 2),
  interest_rate numeric(5, 3),
  ltv numeric(5, 2),
  arv numeric(12, 2),
  rehab_budget numeric(12, 2),
  term_months integer,
  origination_date date,
  maturity_date date,
  entity_name text,

  -- Pipeline stage (mirrors Pipedrive)
  pipeline_stage text check (pipeline_stage in (
    'New Loan / Listing',
    'Appraisal Paid',
    'Processing / Listed',
    'Underwriting / Contract',
    'Cleared to Close',
    'Closed'
  )),

  -- Sync metadata
  last_synced_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- CONDITION TEMPLATES
-- Reusable conditions you can apply to any loan in one click.
-- ============================================================
create table if not exists condition_templates (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  description text,
  loan_type text, -- null = applies to all loan types
  created_at timestamptz default now()
);

-- ============================================================
-- CONDITIONS
-- Per-loan underwriting conditions. Managed in admin panel.
-- ============================================================
create table if not exists conditions (
  id uuid primary key default uuid_generate_v4(),
  loan_id uuid references loans(id) on delete cascade not null,
  title text not null,
  description text,
  status text default 'Outstanding' check (status in (
    'Outstanding',
    'Received',
    'Satisfied',
    'Waived'
  )),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- DOCUMENTS
-- Files uploaded by borrowers or admins against a condition.
-- Stored in Supabase Storage.
-- ============================================================
create table if not exists documents (
  id uuid primary key default uuid_generate_v4(),
  loan_id uuid references loans(id) on delete cascade not null,
  condition_id uuid references conditions(id) on delete set null,
  uploaded_by_borrower_id uuid references borrowers(id) on delete set null,
  file_name text not null,
  file_path text not null, -- path in Supabase Storage bucket
  file_size integer,
  created_at timestamptz default now()
);

-- ============================================================
-- ADMIN USERS
-- Your team members who manage the portal.
-- ============================================================
create table if not exists admin_users (
  id uuid primary key default uuid_generate_v4(),
  auth_user_id uuid references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text,
  role text default 'loan_officer' check (role in ('admin', 'loan_officer')),
  created_at timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- Critical: ensures borrowers can only see their own data.
-- ============================================================

alter table borrowers enable row level security;
alter table loans enable row level security;
alter table conditions enable row level security;
alter table documents enable row level security;
alter table condition_templates enable row level security;
alter table admin_users enable row level security;

-- Borrowers can only read their own borrower record
create policy "Borrowers can view own record"
  on borrowers for select
  using (auth.uid() = auth_user_id);

-- Borrowers can only see their own loans
create policy "Borrowers can view own loans"
  on loans for select
  using (
    borrower_id in (
      select id from borrowers where auth_user_id = auth.uid()
    )
  );

-- Borrowers can only see conditions on their own loans
create policy "Borrowers can view own conditions"
  on conditions for select
  using (
    loan_id in (
      select l.id from loans l
      join borrowers b on b.id = l.borrower_id
      where b.auth_user_id = auth.uid()
    )
  );

-- Borrowers can only see documents on their own loans
create policy "Borrowers can view own documents"
  on documents for select
  using (
    loan_id in (
      select l.id from loans l
      join borrowers b on b.id = l.borrower_id
      where b.auth_user_id = auth.uid()
    )
  );

-- Borrowers can upload documents to their own loans
create policy "Borrowers can upload documents"
  on documents for insert
  with check (
    loan_id in (
      select l.id from loans l
      join borrowers b on b.id = l.borrower_id
      where b.auth_user_id = auth.uid()
    )
  );

-- Everyone can read condition templates (used to populate conditions)
create policy "Anyone can view condition templates"
  on condition_templates for select
  using (true);

-- Admin users can read their own record
create policy "Admins can view own record"
  on admin_users for select
  using (auth.uid() = auth_user_id);

-- ============================================================
-- SEED: Default Condition Templates
-- Common underwriting conditions for each loan type.
-- ============================================================

insert into condition_templates (title, description, loan_type) values
  -- All loan types
  ('Government-Issued Photo ID', 'Copy of valid driver''s license or passport for all borrowers/guarantors.', null),
  ('Entity Documents', 'Articles of incorporation, operating agreement, and certificate of good standing for borrowing entity.', null),
  ('Proof of Insurance', 'Hazard insurance binder showing lender as mortgagee/loss payee.', null),
  ('Title Commitment', 'Preliminary title commitment from title company.', null),
  ('Signed Loan Application', 'Completed and signed loan application.', null),
  ('Bank Statements (3 months)', 'Most recent 3 months of bank statements for all accounts.', null),
  ('Credit Authorization', 'Signed credit pull authorization for all guarantors.', null),

  -- Bridge / Fix & Flip
  ('Scope of Work', 'Detailed scope of work and itemized rehab budget from licensed contractor.', 'Fix & Flip'),
  ('Contractor License & Insurance', 'Copy of contractor''s license and general liability insurance.', 'Fix & Flip'),
  ('ARV Appraisal', 'As-repaired value appraisal from approved appraiser.', 'Fix & Flip'),
  ('Purchase Contract', 'Fully executed purchase and sale agreement.', 'Fix & Flip'),
  ('Draw Schedule', 'Agreed draw schedule tied to construction milestones.', 'Fix & Flip'),

  -- New Construction
  ('Building Plans & Permits', 'Approved building plans and issued construction permits.', 'New Construction'),
  ('Construction Budget', 'Detailed construction budget and draw schedule.', 'New Construction'),
  ('Builder''s Risk Insurance', 'Builder''s risk insurance policy naming lender as additional insured.', 'New Construction'),
  ('Survey', 'Current survey of subject property.', 'New Construction'),

  -- Bridge
  ('Exit Strategy Documentation', 'Written exit strategy (refinance approval letter, listing agreement, or sale contract).', 'Bridge'),
  ('Property Photos', 'Interior and exterior photos of subject property.', 'Bridge'),

  -- DSCR
  ('Lease Agreement(s)', 'Executed lease agreement(s) for all units.', 'DSCR'),
  ('Rent Roll', 'Current rent roll signed by borrower.', 'DSCR'),
  ('DSCR Appraisal', 'Full appraisal with rent schedule from approved appraiser.', 'DSCR'),
  ('Property Management Agreement', 'Property management agreement if professionally managed.', 'DSCR'),
  ('Mortgage Statements', 'Most recent 12 months mortgage statements for all investment properties.', 'DSCR');

-- ============================================================
-- UPDATED_AT TRIGGER
-- Automatically updates updated_at on row changes.
-- ============================================================

create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_borrowers_updated_at
  before update on borrowers
  for each row execute function update_updated_at_column();

create trigger update_loans_updated_at
  before update on loans
  for each row execute function update_updated_at_column();

create trigger update_conditions_updated_at
  before update on conditions
  for each row execute function update_updated_at_column();
