-- ============================================================
-- First Equity Portal — Migration 02
-- Adds staff tables, audit/intake tables, RPCs, and missing
-- columns/constraints that the current code expects but the
-- original schema.sql doesn't define.
--
-- Safe to re-run: all statements are idempotent.
-- Paste the entire file into Supabase SQL Editor → Run.
-- ============================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================================
-- STAFF TABLES
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
-- LOANS — additional columns
-- ============================================================

alter table loans add column if not exists loan_officer_id    uuid references loan_officers(id) on delete set null;
alter table loans add column if not exists loan_processor_id  uuid references loan_processors(id) on delete set null;
alter table loans add column if not exists underwriter_id     uuid references underwriters(id) on delete set null;
alter table loans add column if not exists loan_number              text;
alter table loans add column if not exists rate_locked_days         text;
alter table loans add column if not exists rate_lock_expiration_date date;
alter table loans add column if not exists interest_only            text;
alter table loans add column if not exists loan_type_ii             text;
alter table loans add column if not exists estimated_closing_date   date;
alter table loans add column if not exists archived                 boolean default false not null;
alter table loans add column if not exists closed_at                timestamptz;

-- ============================================================
-- BORROWERS — additional columns (JotForm intake)
-- ============================================================

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
-- CONDITIONS — additional columns + CHECK updates
-- ============================================================

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
-- CONDITION TEMPLATES — additional columns + CHECK updates
-- ============================================================

alter table condition_templates add column if not exists assigned_to text default 'borrower';
alter table condition_templates add column if not exists category    text;

alter table condition_templates drop constraint if exists condition_templates_assigned_to_check;
alter table condition_templates add  constraint condition_templates_assigned_to_check
  check (assigned_to in ('borrower', 'loan_officer', 'loan_processor', 'underwriter'));

alter table condition_templates drop constraint if exists condition_templates_category_check;
alter table condition_templates add  constraint condition_templates_category_check
  check (category is null or category in ('initial', 'underwriting', 'pre_close', 'pre_funding'));

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

create index if not exists loan_events_loan_id_idx     on loan_events(loan_id);
create index if not exists loan_events_created_at_idx  on loan_events(created_at desc);

-- ============================================================
-- LOAN NOTES
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
  property_street text,
  property_city text,
  property_state text,
  property_zip text,
  property_type text,
  number_of_units integer,
  flood_zone text,
  square_footage numeric,
  units_vacant boolean,
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
  title_company text,
  title_email text,
  title_phone text,
  insurance_company text,
  insurance_email text,
  insurance_phone text,
  vesting_in_entity boolean,
  entity_type text,
  entity_formation_state text,
  down_payment_borrowed boolean,
  intent_to_occupy boolean,
  declarations jsonb,
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
-- LOAN DEMOGRAPHICS (one row per loan)
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
-- RLS — enable on all new tables; existing borrower/admin
-- policies from schema.sql are preserved.
-- ============================================================

alter table loan_officers          enable row level security;
alter table loan_processors        enable row level security;
alter table underwriters           enable row level security;
alter table loan_events            enable row level security;
alter table loan_notes             enable row level security;
alter table loan_details           enable row level security;
alter table loan_demographics      enable row level security;
alter table loan_stage_history     enable row level security;
alter table condition_action_tokens enable row level security;

-- Staff can read own role row (used for the auth check on every page)
drop policy if exists "LOs can view own record" on loan_officers;
create policy "LOs can view own record" on loan_officers
  for select using (auth.uid() = auth_user_id);

drop policy if exists "LPs can view own record" on loan_processors;
create policy "LPs can view own record" on loan_processors
  for select using (auth.uid() = auth_user_id);

drop policy if exists "UWs can view own record" on underwriters;
create policy "UWs can view own record" on underwriters
  for select using (auth.uid() = auth_user_id);

-- All other staff-only tables: no policies = default deny = only
-- service-role (createAdminClient) can read/write. That's intentional
-- — borrowers should never see audit logs, internal notes, etc.

-- ============================================================
-- RPCs
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
-- updated_at triggers for new tables
-- ============================================================

drop trigger if exists update_loan_details_updated_at on loan_details;
create trigger update_loan_details_updated_at
  before update on loan_details
  for each row execute function update_updated_at_column();

drop trigger if exists update_loan_demographics_updated_at on loan_demographics;
create trigger update_loan_demographics_updated_at
  before update on loan_demographics
  for each row execute function update_updated_at_column();
