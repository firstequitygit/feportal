-- Bulk upload conditions: add owner column, partial index, RLS for unmatched rows.
-- Spec: docs/superpowers/specs/2026-05-29-bulk-upload-conditions-design.md

-- Track upload ownership for all roles (existing uploaded_by_borrower_id only covers borrowers).
alter table documents
  add column if not exists uploaded_by_user_id uuid references auth.users(id) on delete set null;

create index if not exists documents_uploaded_by_user_id_idx
  on documents (uploaded_by_user_id);

-- Cheap "list unmatched on this loan" lookup.
create index if not exists documents_unmatched_idx
  on documents (loan_id) where condition_id is null;

-- RLS for unmatched rows. Existing matched-row policies are untouched.
-- Note: API routes use createAdminClient() and bypass RLS; these policies are
-- defense-in-depth for any future code path that uses the authenticated client.

drop policy if exists "Borrowers can update own unmatched documents" on documents;
create policy "Borrowers can update own unmatched documents" on documents
  for update using (
    condition_id is null
    and uploaded_by_user_id = auth.uid()
    and loan_id in (
      select l.id from loans l
      join borrowers b on b.id = l.borrower_id
      where b.auth_user_id = auth.uid()
    )
  );

drop policy if exists "Borrowers can delete own unmatched documents" on documents;
create policy "Borrowers can delete own unmatched documents" on documents
  for delete using (
    condition_id is null
    and uploaded_by_user_id = auth.uid()
    and loan_id in (
      select l.id from loans l
      join borrowers b on b.id = l.borrower_id
      where b.auth_user_id = auth.uid()
    )
  );
