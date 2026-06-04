-- Per-user saved views for the Loan Details card. Each row is one
-- "view" a staff user has saved, with the list of field keys that
-- should be hidden when the view is active.
--
-- Scope: any authenticated staff role (admin / LO / LP / UW) can
-- save and switch between their own views. Borrowers + brokers
-- don't see the Loan Details card so they're not in scope.
--
-- Forward shape:
--   id           uuid
--   user_id      uuid → auth.users(id) (stable across role tables)
--   name         text (unique per user)
--   hidden_fields jsonb (array of field keys from
--                 src/lib/loan-details-fields.ts, e.g.
--                 ["min_number","loan_application","credit_frozen"])
--   is_default   bool — at most one per user; auto-applies when the
--                user opens a loan
--   created_at, updated_at

create table if not exists loan_detail_views (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  name          text not null,
  hidden_fields jsonb default '[]'::jsonb not null,
  is_default    boolean default false not null,
  created_at    timestamptz default now() not null,
  updated_at    timestamptz default now() not null
);

-- Unique view name per user — "DSCR Review" can exist once for each
-- UW but doesn't collide across users.
create unique index if not exists idx_loan_detail_views_unique_name
  on loan_detail_views (user_id, lower(name));

-- At most one default per user. Postgres lets a partial unique index
-- enforce this without blocking multiple non-default rows.
create unique index if not exists idx_loan_detail_views_one_default
  on loan_detail_views (user_id)
  where is_default = true;

-- Cheap lookup by owner.
create index if not exists idx_loan_detail_views_user
  on loan_detail_views (user_id);
