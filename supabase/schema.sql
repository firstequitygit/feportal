-- ============================================================
-- First Equity Funding Borrower Portal — Database Schema
--
-- Single-file setup for the portal database. Run this entire
-- file in Supabase SQL Editor (or your psql client of choice)
-- against a fresh Supabase project.
--
-- Safe to re-run: every statement is idempotent.
--   • Tables / columns / indexes — `if not exists`
--   • Constraints / policies / triggers — drop-if-exists + create
--   • Functions — `create or replace`
--   • Seed inserts — guarded by "if table empty" check
--
-- Schema overview:
--   Role tables      — admin_users, loan_officers, loan_processors,
--                      underwriters, borrowers
--   Core             — loans, conditions, condition_templates,
--                      documents
--   Audit & intake   — loan_events, loan_notes, loan_details,
--                      loan_demographics, loan_stage_history
--   Auth helpers     — condition_action_tokens (one-click email
--                      action links from notification emails)
--   RPCs             — get_archived_loan_ids, set_loan_archived
-- ============================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================================
-- updated_at trigger function (used by multiple tables)
-- ============================================================

create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================
-- STAFF TABLES
-- Created first since loans FKs reference them.
-- ============================================================

create table if not exists loan_officers (
  id uuid primary key default uuid_generate_v4(),
  auth_user_id uuid references auth.users(id) on delete cascade,
  full_name text not null,
  email text unique,
  phone text,
  title text,
  created_at timestamptz default now()
);

create table if not exists loan_processors (
  id uuid primary key default uuid_generate_v4(),
  auth_user_id uuid references auth.users(id) on delete cascade,
  full_name text not null,
  email text unique,
  phone text,
  title text,
  created_at timestamptz default now()
);

create table if not exists underwriters (
  id uuid primary key default uuid_generate_v4(),
  auth_user_id uuid references auth.users(id) on delete cascade,
  full_name text not null,
  email text unique,
  phone text,
  title text,
  created_at timestamptz default now()
);

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
  current_address_street text,
  current_address_city   text,
  current_address_state  text,
  current_address_zip    text,
  at_current_address_2y  boolean,
  prior_address_street   text,
  prior_address_city     text,
  prior_address_state    text,
  prior_address_zip      text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Backfill columns for portals upgrading from an older schema
alter table borrowers add column if not exists current_address_street text;
alter table borrowers add column if not exists current_address_city   text;
alter table borrowers add column if not exists current_address_state  text;
alter table borrowers add column if not exists current_address_zip    text;
alter table borrowers add column if not exists at_current_address_2y  boolean;
alter table borrowers add column if not exists prior_address_street   text;
alter table borrowers add column if not exists prior_address_city     text;
alter table borrowers add column if not exists prior_address_state    text;
alter table borrowers add column if not exists prior_address_zip      text;

-- ============================================================
-- LOANS
-- Synced from Pipedrive deals. Pipedrive is source of truth.
-- ============================================================

create table if not exists loans (
  id uuid primary key default uuid_generate_v4(),
  pipedrive_deal_id integer unique not null,
  borrower_id uuid references borrowers(id) on delete set null,
  loan_officer_id   uuid references loan_officers(id)   on delete set null,
  loan_processor_id uuid references loan_processors(id) on delete set null,
  underwriter_id    uuid references underwriters(id)    on delete set null,

  -- Property
  property_address text,

  -- Loan details
  loan_type text check (loan_type in ('Fix & Flip (Bridge)', 'Rental (DSCR)', 'New Construction')),
  loan_amount numeric(12, 2),
  interest_rate numeric(5, 3),
  ltv numeric(5, 2),
  arv numeric(12, 2),
  rehab_budget numeric(12, 2),
  term_months integer,
  origination_date date,
  maturity_date date,
  estimated_closing_date date,
  entity_name text,
  loan_number text,
  rate_locked_days text,
  rate_lock_expiration_date date,
  interest_only text,
  loan_type_ii text,

  -- Pipeline (mirrors Pipedrive stage)
  pipeline_stage text check (pipeline_stage in (
    'New Application',
    'Processing',
    'Pre-Underwriting',
    'Underwriting',
    'Submitted',
    'Closed'
  )),

  -- Lifecycle
  archived boolean default false not null,
  closed_at timestamptz,

  -- Sync metadata
  last_synced_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Backfill columns for portals upgrading from an older schema
alter table loans add column if not exists loan_officer_id        uuid references loan_officers(id)   on delete set null;
alter table loans add column if not exists loan_processor_id      uuid references loan_processors(id) on delete set null;
alter table loans add column if not exists underwriter_id         uuid references underwriters(id)    on delete set null;
alter table loans add column if not exists loan_number            text;
alter table loans add column if not exists rate_locked_days       text;
alter table loans add column if not exists rate_lock_expiration_date date;
alter table loans add column if not exists interest_only          text;
alter table loans add column if not exists loan_type_ii           text;
alter table loans add column if not exists estimated_closing_date date;
alter table loans add column if not exists archived               boolean default false not null;
alter table loans add column if not exists closed_at              timestamptz;

-- ============================================================
-- CONDITION TEMPLATES
-- ============================================================

create table if not exists condition_templates (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  description text,
  loan_type text,
  assigned_to text default 'borrower',
  category text,
  created_at timestamptz default now()
);

alter table condition_templates add column if not exists assigned_to text default 'borrower';
alter table condition_templates add column if not exists category    text;

alter table condition_templates drop constraint if exists condition_templates_assigned_to_check;
alter table condition_templates add  constraint condition_templates_assigned_to_check
  check (assigned_to in ('borrower', 'loan_officer', 'loan_processor', 'underwriter'));

alter table condition_templates drop constraint if exists condition_templates_category_check;
alter table condition_templates add  constraint condition_templates_category_check
  check (category is null or category in ('initial', 'underwriting', 'pre_close', 'pre_funding'));

-- ============================================================
-- CONDITIONS
-- ============================================================

create table if not exists conditions (
  id uuid primary key default uuid_generate_v4(),
  loan_id uuid references loans(id) on delete cascade not null,
  title text not null,
  description text,
  status text default 'Outstanding',
  assigned_to text default 'borrower' not null,
  category text,
  rejection_reason text,
  response text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table conditions add column if not exists assigned_to      text default 'borrower' not null;
alter table conditions add column if not exists category         text;
alter table conditions add column if not exists rejection_reason text;
alter table conditions add column if not exists response         text;

alter table conditions drop constraint if exists conditions_status_check;
alter table conditions add  constraint conditions_status_check
  check (status in ('Outstanding', 'Received', 'Satisfied', 'Waived', 'Rejected'));

alter table conditions drop constraint if exists conditions_assigned_to_check;
alter table conditions add  constraint conditions_assigned_to_check
  check (assigned_to in ('borrower', 'loan_officer', 'loan_processor', 'underwriter'));

alter table conditions drop constraint if exists conditions_category_check;
alter table conditions add  constraint conditions_category_check
  check (category is null or category in ('initial', 'underwriting', 'pre_close', 'pre_funding'));

-- ============================================================
-- DOCUMENTS
-- ============================================================

create table if not exists documents (
  id uuid primary key default uuid_generate_v4(),
  loan_id uuid references loans(id) on delete cascade not null,
  condition_id uuid references conditions(id) on delete set null,
  uploaded_by_borrower_id uuid references borrowers(id) on delete set null,
  file_name text not null,
  file_path text not null,
  file_size integer,
  created_at timestamptz default now()
);

-- ============================================================
-- ADMIN USERS
-- Your portal admins (typically the lender's leadership).
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
-- LOAN EVENTS (audit log)
-- ============================================================

create table if not exists loan_events (
  id uuid primary key default uuid_generate_v4(),
  loan_id uuid references loans(id) on delete cascade not null,
  event_type text not null,
  description text,
  created_at timestamptz default now()
);

create index if not exists loan_events_loan_id_idx    on loan_events(loan_id);
create index if not exists loan_events_created_at_idx on loan_events(created_at desc);

-- ============================================================
-- LOAN NOTES (internal staff notes)
-- ============================================================

create table if not exists loan_notes (
  id uuid primary key default uuid_generate_v4(),
  loan_id uuid references loans(id) on delete cascade not null,
  content text not null,
  created_by text,
  created_at timestamptz default now()
);

create index if not exists loan_notes_loan_id_idx on loan_notes(loan_id);

-- ============================================================
-- LOAN DETAILS (one row per loan; JotForm intake data)
-- ============================================================

create table if not exists loan_details (
  id uuid primary key default uuid_generate_v4(),
  loan_id uuid unique references loans(id) on delete cascade not null,
  jotform_submission_id text,
  submitted_at text,

  -- Property
  property_street text,
  property_city text,
  property_state text,
  property_zip text,
  property_type text,
  number_of_units integer,
  flood_zone text,
  square_footage numeric,
  units_vacant boolean,

  -- Loan / borrower
  loan_type_one text,
  initial_loan_amount numeric,
  coborrower_name text,
  experience_borrower text,
  number_of_properties integer,
  experience_notes text,
  liquid_assets_total numeric,
  foreign_national boolean,
  credit_score_estimate integer,
  credit_frozen boolean,
  own_or_rent text,
  mortgage_on_primary boolean,

  -- Third-party contacts
  title_company text,
  title_email text,
  title_phone text,
  insurance_company text,
  insurance_email text,
  insurance_phone text,

  -- Entity
  vesting_in_entity boolean,
  entity_type text,
  entity_formation_state text,

  -- Declarations
  down_payment_borrowed boolean,
  intent_to_occupy boolean,
  declarations jsonb,

  -- Financials
  purchase_price numeric,
  acquisition_date text,
  value_as_is numeric,
  payoff numeric,
  qualifying_rent numeric,
  annual_property_tax numeric,
  annual_insurance_premium numeric,
  annual_hoa_dues numeric,

  jotform_submitted_at timestamptz,
  updated_at timestamptz default now()
);

-- ============================================================
-- LOAN DEMOGRAPHICS (one row per loan; collected via JotForm)
-- ============================================================

create table if not exists loan_demographics (
  id uuid primary key default uuid_generate_v4(),
  loan_id uuid unique references loans(id) on delete cascade not null,
  ethnicity text,
  race text,
  sex text,
  source text,
  updated_at timestamptz default now()
);

-- ============================================================
-- LOAN STAGE HISTORY (timeline of stage transitions)
-- ============================================================

create table if not exists loan_stage_history (
  id uuid primary key default uuid_generate_v4(),
  loan_id uuid references loans(id) on delete cascade not null,
  stage text not null,
  entered_at timestamptz default now() not null,
  exited_at timestamptz
);

create index if not exists loan_stage_history_loan_id_idx on loan_stage_history(loan_id);

-- ============================================================
-- CONDITION ACTION TOKENS (one-click email action links)
-- Emails sent to staff/borrowers include tokenized URLs so they
-- can mark conditions Received/Satisfied/Rejected without login.
-- ============================================================

create table if not exists condition_action_tokens (
  id uuid primary key default uuid_generate_v4(),
  condition_id uuid references conditions(id) on delete cascade not null,
  loan_id uuid references loans(id) on delete cascade not null,
  token text unique not null default replace(gen_random_uuid()::text, '-', ''),
  expires_at timestamptz default (now() + interval '7 days') not null,
  created_at timestamptz default now()
);

create index if not exists condition_action_tokens_token_idx on condition_action_tokens(token);

-- ============================================================
-- ROW LEVEL SECURITY
-- Borrowers can only see their own data. Staff users access via
-- service-role (createAdminClient) which bypasses RLS, so most
-- staff-only tables have no policies (default deny).
-- ============================================================

alter table borrowers              enable row level security;
alter table loans                  enable row level security;
alter table conditions             enable row level security;
alter table documents              enable row level security;
alter table condition_templates    enable row level security;
alter table admin_users            enable row level security;
alter table loan_officers          enable row level security;
alter table loan_processors        enable row level security;
alter table underwriters           enable row level security;
alter table loan_events            enable row level security;
alter table loan_notes             enable row level security;
alter table loan_details           enable row level security;
alter table loan_demographics      enable row level security;
alter table loan_stage_history     enable row level security;
alter table condition_action_tokens enable row level security;

-- Borrower policies
drop policy if exists "Borrowers can view own record" on borrowers;
create policy "Borrowers can view own record" on borrowers
  for select using (auth.uid() = auth_user_id);

drop policy if exists "Borrowers can view own loans" on loans;
create policy "Borrowers can view own loans" on loans
  for select using (
    borrower_id in (select id from borrowers where auth_user_id = auth.uid())
  );

drop policy if exists "Borrowers can view own conditions" on conditions;
create policy "Borrowers can view own conditions" on conditions
  for select using (
    loan_id in (
      select l.id from loans l
      join borrowers b on b.id = l.borrower_id
      where b.auth_user_id = auth.uid()
    )
  );

drop policy if exists "Borrowers can view own documents" on documents;
create policy "Borrowers can view own documents" on documents
  for select using (
    loan_id in (
      select l.id from loans l
      join borrowers b on b.id = l.borrower_id
      where b.auth_user_id = auth.uid()
    )
  );

drop policy if exists "Borrowers can upload documents" on documents;
create policy "Borrowers can upload documents" on documents
  for insert with check (
    loan_id in (
      select l.id from loans l
      join borrowers b on b.id = l.borrower_id
      where b.auth_user_id = auth.uid()
    )
  );

-- Condition templates are public-read (used to populate dropdowns)
drop policy if exists "Anyone can view condition templates" on condition_templates;
create policy "Anyone can view condition templates" on condition_templates
  for select using (true);

-- Staff "view own record" policies (used by auth checks at the top
-- of every Server Component / API route)
drop policy if exists "Admins can view own record" on admin_users;
create policy "Admins can view own record" on admin_users
  for select using (auth.uid() = auth_user_id);

drop policy if exists "LOs can view own record" on loan_officers;
create policy "LOs can view own record" on loan_officers
  for select using (auth.uid() = auth_user_id);

drop policy if exists "LPs can view own record" on loan_processors;
create policy "LPs can view own record" on loan_processors
  for select using (auth.uid() = auth_user_id);

drop policy if exists "UWs can view own record" on underwriters;
create policy "UWs can view own record" on underwriters
  for select using (auth.uid() = auth_user_id);

-- All other staff-only tables have no policies = default deny.
-- Only service-role (createAdminClient) can read/write them.

-- ============================================================
-- RPC FUNCTIONS
-- ============================================================

create or replace function get_archived_loan_ids()
returns setof uuid
language sql
security definer
set search_path = public
as $$
  select id from loans where archived = true;
$$;

create or replace function set_loan_archived(p_loan_id uuid, p_archived boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update loans
     set archived = p_archived,
         closed_at = case
           when p_archived = true and closed_at is null then now()
           else closed_at
         end
   where id = p_loan_id;
$$;

-- ============================================================
-- TRIGGERS — auto-update updated_at on row changes
-- ============================================================

drop trigger if exists update_borrowers_updated_at on borrowers;
create trigger update_borrowers_updated_at
  before update on borrowers
  for each row execute function update_updated_at_column();

drop trigger if exists update_loans_updated_at on loans;
create trigger update_loans_updated_at
  before update on loans
  for each row execute function update_updated_at_column();

drop trigger if exists update_conditions_updated_at on conditions;
create trigger update_conditions_updated_at
  before update on conditions
  for each row execute function update_updated_at_column();

drop trigger if exists update_loan_details_updated_at on loan_details;
create trigger update_loan_details_updated_at
  before update on loan_details
  for each row execute function update_updated_at_column();

drop trigger if exists update_loan_demographics_updated_at on loan_demographics;
create trigger update_loan_demographics_updated_at
  before update on loan_demographics
  for each row execute function update_updated_at_column();

-- ============================================================
-- SEED: Default Condition Templates (only inserts if table empty)
-- ============================================================

do $$
begin
  if not exists (select 1 from condition_templates limit 1) then
    insert into condition_templates (title, description, loan_type) values
      -- All loan types
      ('Government-Issued Photo ID', 'Copy of valid driver''s license or passport for all borrowers/guarantors.', null),
      ('Entity Documents', 'Articles of incorporation, operating agreement, and certificate of good standing for borrowing entity.', null),
      ('Proof of Insurance', 'Hazard insurance binder showing lender as mortgagee/loss payee.', null),
      ('Title Commitment', 'Preliminary title commitment from title company.', null),
      ('Signed Loan Application', 'Completed and signed loan application.', null),
      ('Bank Statements (3 months)', 'Most recent 3 months of bank statements for all accounts.', null),
      ('Credit Authorization', 'Signed credit pull authorization for all guarantors.', null),

      -- Fix & Flip (Bridge) — combines former Bridge + Fix & Flip
      ('Scope of Work', 'Detailed scope of work and itemized rehab budget from licensed contractor.', 'Fix & Flip (Bridge)'),
      ('Contractor License & Insurance', 'Copy of contractor''s license and general liability insurance.', 'Fix & Flip (Bridge)'),
      ('ARV Appraisal', 'As-repaired value appraisal from approved appraiser.', 'Fix & Flip (Bridge)'),
      ('Purchase Contract', 'Fully executed purchase and sale agreement.', 'Fix & Flip (Bridge)'),
      ('Draw Schedule', 'Agreed draw schedule tied to construction milestones.', 'Fix & Flip (Bridge)'),
      ('Exit Strategy Documentation', 'Written exit strategy (refinance approval letter, listing agreement, or sale contract).', 'Fix & Flip (Bridge)'),
      ('Property Photos', 'Interior and exterior photos of subject property.', 'Fix & Flip (Bridge)'),

      -- New Construction
      ('Building Plans & Permits', 'Approved building plans and issued construction permits.', 'New Construction'),
      ('Construction Budget', 'Detailed construction budget and draw schedule.', 'New Construction'),
      ('Builder''s Risk Insurance', 'Builder''s risk insurance policy naming lender as additional insured.', 'New Construction'),
      ('Survey', 'Current survey of subject property.', 'New Construction'),

      -- Rental (DSCR)
      ('Lease Agreement(s)', 'Executed lease agreement(s) for all units.', 'Rental (DSCR)'),
      ('Rent Roll', 'Current rent roll signed by borrower.', 'Rental (DSCR)'),
      ('DSCR Appraisal', 'Full appraisal with rent schedule from approved appraiser.', 'Rental (DSCR)'),
      ('Property Management Agreement', 'Property management agreement if professionally managed.', 'Rental (DSCR)'),
      ('Mortgage Statements', 'Most recent 12 months mortgage statements for all investment properties.', 'Rental (DSCR)');
  end if;
end $$;
