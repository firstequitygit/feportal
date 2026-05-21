-- Track each /api/auth/send-otp call so the server can enforce a 60-sec
-- cooldown and a per-email-per-hour cap. Cleanup runs inline on each
-- request (delete rows older than 1 hour for the requesting email).

create table if not exists public.auth_otp_sends (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  sent_at timestamptz not null default now()
);

create index if not exists auth_otp_sends_email_sent_at_idx
  on public.auth_otp_sends (email, sent_at desc);

-- Service-role-only; no RLS exposure to anon/authenticated clients.
alter table public.auth_otp_sends enable row level security;
