-- Co-borrowers: up to 3 additional borrowers per loan (4 total).
-- Mirrors the two-LP pattern. borrower_id stays the "primary" — that's
-- the original Pipedrive Person sync and JotForm intake target.
-- borrower_id_2/3/4 are added on the loan detail page by an admin / LO / LP
-- after invite. Each co-borrower has their own portal login.

alter table loans add column if not exists borrower_id_2 uuid references borrowers(id) on delete set null;
alter table loans add column if not exists borrower_id_3 uuid references borrowers(id) on delete set null;
alter table loans add column if not exists borrower_id_4 uuid references borrowers(id) on delete set null;

create index if not exists idx_loans_borrower_id_2 on loans(borrower_id_2);
create index if not exists idx_loans_borrower_id_3 on loans(borrower_id_3);
create index if not exists idx_loans_borrower_id_4 on loans(borrower_id_4);
