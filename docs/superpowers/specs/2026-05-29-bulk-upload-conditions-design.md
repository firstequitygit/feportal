# Bulk Upload Conditions - Design

**Date:** 2026-05-29
**Status:** Approved
**Origin:** Loan processor wish - "when bulk uploading conditions for UW, can it know where each file should go (e.g. Operating Agreement -> Operating Agreement condition) instead of one big bulk?"

## Goal

Let any role that can upload documents drop a pile of files at once, have the system auto-suggest which condition each file satisfies, and provide a two-column drag-and-drop matcher to confirm or correct the suggestions. Files that aren't matched in a session persist on the loan as "Unmatched documents" for later sorting.

## Non-goals (v1)

- Aliases dictionary (hardcoded or per-template) for smarter matching.
- Bulk delete from the Unmatched card.
- Audit log entries for upload / match / unmatch (`loan_events` can absorb later).
- Move/copy storage paths when matching - file_path stays stable; only `condition_id` changes.
- Refactoring the three existing per-role `handleUpload` copies into one. The new endpoint coexists.

## Data model

Reuse the existing `documents` table. `condition_id` is already declared nullable, so "unmatched" = `documents` row where `condition_id IS NULL`. No new table.

**Migration additions:**

```sql
alter table documents
  add column if not exists uploaded_by_user_id uuid references auth.users(id) on delete set null;

create index if not exists documents_unmatched_idx
  on documents (loan_id) where condition_id is null;
```

`uploaded_by_user_id` lets us distinguish borrower-uploaded vs staff-uploaded for the role-scoped Unmatched view, and works for all roles (the existing `uploaded_by_borrower_id` only covered borrowers). New code paths populate `uploaded_by_user_id`; the legacy `uploaded_by_borrower_id` column is left intact for backwards compat.

The partial index keeps the "list unmatched on this loan" query cheap; it's queried on every loan page load.

Matching a file to a condition is one statement:

```sql
update documents set condition_id = $1 where id = $2;
```

Un-matching is the same statement with `condition_id = null`.

## API surface

All three endpoints check the caller's role and loan membership before touching the row.

### `POST /api/documents/bulk-upload`

Multipart form, accepts N files plus `loan_id` in the body.

For each file:
1. Write to Supabase Storage at `loans/{loan_id}/documents/{uuid}-{original_name}`.
2. Insert a `documents` row with `condition_id = NULL`, `loan_id = <body>`, `uploaded_by_user_id = <caller>`, `file_name = original`, `file_path = storage_path`, `file_size`.

Returns the inserted rows plus a computed `suggested_condition_id` per row (not persisted - just sent to the client for the matcher UI).

Computed server-side because the condition list is loan-specific and we don't want to ship it to the client just to run substring matching.

### `PATCH /api/documents/{id}/match`

Body: `{ condition_id: string | null }`.

Single UPDATE. 403 if:
- Caller can't see the loan.
- Caller is a borrower and they're not `uploaded_by_user_id`.

### `GET /api/loans/{id}/documents/unmatched`

Returns unmatched docs on the loan, scoped by role:
- Borrower: only rows where `uploaded_by_user_id = <self>`.
- Staff (LO/LP/UW assigned to the loan, plus admins): all unmatched.

Used to populate the "Unmatched documents (N)" card on the loan page.

## Matching algorithm

`src/lib/match-condition.ts`:

```ts
export function suggestConditionId(
  filename: string,
  conditions: { id: string; title: string }[],
): string | null
```

1. Normalize the filename: strip extension, lowercase, replace `_` and `-` with spaces, collapse whitespace.
2. For each condition: check whether `normalized_filename` contains `condition.title.toLowerCase()`.
3. Of all matches, return the one with the longest `title` (most specific wins).
4. Return `null` if no condition title is a substring.

Examples:
- `operating_agreement_v2.pdf` -> "Operating Agreement" (substring match, only match).
- `OA_LLC_signed.pdf` -> `null` (no condition title is a substring).
- `2023_tax_return.pdf` -> "Tax Return" if that's a condition title.

Pure function, no external deps. Easy to unit-test directly.

## UI flow

### Entry point

A `Bulk Upload` button at the top of the conditions list on every role's loan view. Same affordance for all roles; visibility differences happen later in the data, not at the button.

### Bulk upload modal

**Step 1 - drop.** Full-modal dropzone. On drop, files POST to `/api/documents/bulk-upload` immediately and a per-file progress bar appears. Files are added to the left column as each upload completes. Modal cannot be dismissed without confirmation while uploads are in flight.

**Step 2 - match.** Once uploads finish, the modal switches to the two-column matcher.

**Left column - "Files to match" (N).** Each row: file icon, original filename, status pill:
- `Auto-matched: <Condition Title>` (yellow) - the matcher returned a suggestion. Row visually appears under that condition in the right column too.
- `Unmatched` (gray) - no suggestion. Sits in an Unassigned tray at top of left column.
- `Confirmed` (green) - user has confirmed the match.

**Right column - "Conditions".** Existing condition list, grouped by category (Initial / Underwriting / Pre-Close / Pre-Funding). Each condition shows files currently staged for it (auto-matched or dragged-in) with a small "x" to send back to the left.

**Interactions:**
- Drag left-column file onto a right-column condition: stage it there, pill -> `Confirmed`.
- Drag right-column staged file back to left: unstage.
- Click "Confirm" on an auto-matched row: accept without dragging.
- Footer `Save matches`: commits all `Confirmed` rows via `PATCH /api/documents/{id}/match`. Files still `Auto-matched` or `Unmatched` stay where they are (already in `documents` with `condition_id IS NULL`, so they persist as Unmatched on the loan).
- Footer `Close`: same behavior as Save for unconfirmed rows. No "discard" - files are already uploaded; closing is a deferred-match, not a cancel.

**Collision behavior.** If a file is dragged onto a condition that already has documents, append - same as the existing per-condition upload flow.

### Unmatched documents card

Always visible on the loan page (above the condition sections). Collapsible. Header: `Unmatched documents (N)` where N is the role-scoped count. Hidden entirely if N = 0.

Each row: filename, uploader, upload timestamp. Two actions:
- `Match`: opens the same matcher modal pre-populated with this loan's unmatched docs (re-runs auto-match against current conditions, in case conditions were added/renamed since upload). Goes straight to step 2 - no upload step.
- `Delete`: removes the row and the file from storage. Allowed for: original uploader, or any staff.

## Permissions

Already covered by API checks above. RLS on `documents` gets *new* policies covering the unmatched case (`condition_id IS NULL`); existing policies for matched documents are untouched.

New policies (scoped to `condition_id IS NULL`):
- Borrower: `select` / `update` / `delete` only where `uploaded_by_user_id = auth.uid()` AND loan is theirs.
- Staff assigned to the loan (LO/LP/UW): `select` / `update` / `delete` on any unmatched row on the loan.
- Admins: all unmatched rows.

Matched-row deletion remains the existing per-condition flow and is out of scope for this design.

`playwright-role-gates` runs in verification phase to confirm none of these guards regress.

## Error handling

Only the cases that can actually happen:

- File over storage limit: per-file inline error in left column, row stays as failed upload, other files continue.
- Network drop mid-upload: already-uploaded files persist as Unmatched (this is desired behavior). Failed files show a retry button.
- Match commit fails for one row: show failure, leave other rows applied. Matching is idempotent (UPDATE to same value is a no-op), so no all-or-nothing transaction needed.
- Two users matching the same file simultaneously: last write wins. Not worth a lock; second user sees updated state on refresh.

## Success criteria

1. LP can drop 10 files, see e.g. 7 auto-matched and 3 unmatched, override one wrong auto-match by dragging, save, and have all 10 land correctly (matched in their conditions, or persisted as Unmatched).
2. Borrower can bulk-upload from their portal and have files land as Unmatched on the loan, visible to staff but not to other borrowers.
3. Unmatched card shows the role-scoped count and lets the user re-enter the matcher to sort the pile.
4. Each role can only see / match / delete what their permissions allow (verified via `playwright-role-gates`).
5. `next build` passes; preview deploy walkthrough demonstrates 1-4.

## Open questions for implementation

None blocking. Aliases and audit log entries are deferred to v2.
