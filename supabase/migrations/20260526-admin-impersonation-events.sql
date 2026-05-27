create table public.admin_impersonation_events (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid not null references public.admin_users(id),
  target_kind  text not null check (target_kind in
                ('borrower','broker','loan_officer','loan_processor','underwriter')),
  target_id    uuid not null,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  user_agent   text
);

create index admin_impersonation_events_admin_started_idx
  on public.admin_impersonation_events (admin_id, started_at desc);

-- This table is written only by service-role API routes. No RLS policies needed;
-- enabling RLS with no policies denies anon/authenticated access by default.
alter table public.admin_impersonation_events enable row level security;
