-- Broker-variant foundation: kind tracking, authorize-token lifecycle for the
-- new /authorize/[token] route, broker attestation persistence, and a lower(email)
-- index to back the duplicate-account gate. All additive: existing columns are
-- untouched, historical loans get application_kind='borrower' (accurate) and a
-- null authorization_status (semantically "no separate authorize step expected,"
-- preserving the old inline-Step-5 behavior).

alter table loan_applications
  add column if not exists application_kind text not null default 'borrower'
    check (application_kind in ('borrower', 'broker')),
  add column if not exists submitted_by_broker_id uuid references brokers(id);

alter table loans
  add column if not exists application_kind text not null default 'borrower'
    check (application_kind in ('borrower', 'broker')),
  add column if not exists submitted_by_broker_id uuid references brokers(id),
  add column if not exists authorize_token text unique,
  add column if not exists authorization_status text
    check (authorization_status is null or authorization_status in ('pending', 'signed', 'declined', 'expired')),
  add column if not exists authorization_signed_at timestamptz,
  add column if not exists authorization_payment_ref text,
  add column if not exists broker_attestation_text text,
  add column if not exists broker_attestation_signed_name text,
  add column if not exists broker_attestation_signed_at timestamptz;

create index if not exists idx_loans_authorize_token on loans(authorize_token);
create index if not exists idx_borrowers_email_lower on borrowers(lower(email));
