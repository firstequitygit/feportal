# Bulk Upload Conditions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Bulk Upload" feature that lets any role with upload rights drop a pile of files at once, auto-suggests which condition each file satisfies based on filename, and provides a two-column drag-and-drop matcher to confirm or correct. Files left unmatched persist on the loan as "Unmatched documents" for later sorting.

**Architecture:** Reuse the existing `documents` table - `condition_id` is already nullable, so unmatched docs are `documents` rows where `condition_id IS NULL`. Add three role-agnostic API routes (sign URLs, record uploads, match documents), a server-side matcher that suggests conditions by filename substring, two new UI components (modal, card), and small integrations into each of the four role-specific condition views.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + Storage + Auth), React 19, Tailwind, Base UI / shadcn primitives.

**Spec:** [docs/superpowers/specs/2026-05-29-bulk-upload-conditions-design.md](../specs/2026-05-29-bulk-upload-conditions-design.md)

## Project conventions that override the default plan template

1. **No test runner.** This project has no Jest/Vitest. Per the user's CLAUDE.md, `next build` is the correctness gate and Playwright is the integration gate. Tasks below do NOT follow "write failing test -> implement -> pass" cycles. Instead each task ends with `npm run build` and (where applicable) a Playwright drive. The matcher function gets a self-test block at the bottom of its file, runnable as a one-shot via `npx tsx`.
2. **Plain hyphens only**, no em dashes, anywhere in code or copy.
3. **Auth check on every API route.** `next build` does not catch a missing role check. Every new route resolves the caller's role and the loan membership before any DB write.
4. **Commit messages** follow the project's conventional-commit style with scopes: `feat(db):`, `feat(api):`, `feat(lib):`, `feat(ui):`, `fix(...):`.
5. **Dev server** runs on port 3100 in a worktree, not the default 3000.

## File structure

**Create:**
- `supabase/migrations/20260529-documents-bulk-upload.sql` - column, index, RLS policies
- `src/lib/loan-authorization.ts` - shared `getLoanRoleForUser` helper
- `src/lib/match-condition.ts` - pure `suggestConditionId` matcher
- `src/app/api/documents/bulk-upload/sign/route.ts` - returns N signed upload URLs
- `src/app/api/documents/bulk-upload/record/route.ts` - inserts N unmatched rows, returns suggested matches
- `src/app/api/documents/[id]/match/route.ts` - PATCH to set/clear `condition_id`
- `src/app/api/loans/[id]/documents/unmatched/route.ts` - GET role-scoped unmatched docs
- `src/components/bulk-upload-modal.tsx` - shared modal (dropzone + two-column matcher)
- `src/components/unmatched-documents-card.tsx` - shared collapsible card

**Modify (small integrations - add button + card):**
- `src/components/loan-officer-conditions.tsx`
- `src/components/loan-processor-conditions.tsx`
- `src/components/underwriter-conditions.tsx`
- `src/components/conditions-list.tsx` (borrower view)

Existing per-role `/api/{role}/upload` and `/api/{role}/upload/record` routes are unchanged. The bulk endpoints coexist; consolidation is out of scope.

---

## Task 1: Schema migration

**Files:**
- Create: `supabase/migrations/20260529-documents-bulk-upload.sql`

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Apply the migration to local Supabase**

Run: `npx supabase db push` (from the feportal directory; assumes Supabase CLI configured per project)

Expected: migration applied, no errors. If the CLI reports "no project linked", skip and apply via the Supabase MCP (`mcp__claude_ai_Supabase__apply_migration`) against the dev branch.

- [ ] **Step 3: Verify the column and index exist**

Run via Supabase MCP `mcp__claude_ai_Supabase__execute_sql` (read-only):
```sql
select column_name, data_type from information_schema.columns
  where table_name = 'documents' and column_name = 'uploaded_by_user_id';
select indexname from pg_indexes where tablename = 'documents'
  and indexname in ('documents_uploaded_by_user_id_idx', 'documents_unmatched_idx');
```

Expected: one column row, two index rows.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260529-documents-bulk-upload.sql
git commit -m "feat(db): add uploaded_by_user_id and unmatched index on documents"
```

---

## Task 2: Authorization helper

A shared `getLoanRoleForUser` so the three new endpoints don't duplicate the role-resolution logic. Encapsulates the existing pattern (LP `is_ops_manager`, LO/LP/UW assignment checks, borrower ownership).

**Files:**
- Create: `src/lib/loan-authorization.ts`

- [ ] **Step 1: Create the helper file**

```ts
import { SupabaseClient } from '@supabase/supabase-js'

export type LoanRole =
  | { role: 'borrower'; borrowerId: string }
  | { role: 'loan_officer'; loanOfficerId: string }
  | { role: 'loan_processor'; loanProcessorId: string; isOpsManager: boolean }
  | { role: 'underwriter'; underwriterId: string }
  | { role: 'admin' }
  | null

/**
 * Resolves the caller's role on a specific loan. Returns null if the user
 * has no relationship to the loan.
 *
 * Pass the result of createAdminClient() so this can read role tables that
 * the authenticated client cannot.
 */
export async function getLoanRoleForUser(
  adminClient: SupabaseClient,
  loanId: string,
  userId: string,
): Promise<LoanRole> {
  const [{ data: admin }, { data: lo }, { data: lp }, { data: uw }, { data: borrower }] = await Promise.all([
    adminClient.from('admin_users').select('id, role').eq('auth_user_id', userId).maybeSingle(),
    adminClient.from('loan_officers').select('id').eq('auth_user_id', userId).maybeSingle(),
    adminClient.from('loan_processors').select('id, is_ops_manager').eq('auth_user_id', userId).maybeSingle(),
    adminClient.from('underwriters').select('id').eq('auth_user_id', userId).maybeSingle(),
    adminClient.from('borrowers').select('id').eq('auth_user_id', userId).maybeSingle(),
  ])

  if (admin?.role === 'admin') return { role: 'admin' }

  const { data: loan } = await adminClient
    .from('loans')
    .select('borrower_id, loan_officer_id, loan_processor_id, loan_processor_id_2, underwriter_id')
    .eq('id', loanId)
    .maybeSingle()
  if (!loan) return null

  if (borrower && loan.borrower_id === borrower.id) {
    return { role: 'borrower', borrowerId: borrower.id }
  }
  if (lo && loan.loan_officer_id === lo.id) {
    return { role: 'loan_officer', loanOfficerId: lo.id }
  }
  if (lp && (lp.is_ops_manager || loan.loan_processor_id === lp.id || loan.loan_processor_id_2 === lp.id)) {
    return { role: 'loan_processor', loanProcessorId: lp.id, isOpsManager: !!lp.is_ops_manager }
  }
  if (uw && loan.underwriter_id === uw.id) {
    return { role: 'underwriter', underwriterId: uw.id }
  }
  return null
}

/** True if this role can bulk-upload to the loan. All current roles can. */
export function canBulkUpload(role: LoanRole): boolean {
  return role !== null
}

/** True if this role is internal staff (sees all unmatched docs on the loan). */
export function isStaff(role: LoanRole): boolean {
  if (!role) return false
  return role.role !== 'borrower'
}
```

- [ ] **Step 2: Build to typecheck**

Run: `npm run build`

Expected: build succeeds. If it fails on TypeScript errors, fix them inline (most likely missing import for `SupabaseClient` if the version differs).

- [ ] **Step 3: Commit**

```bash
git add src/lib/loan-authorization.ts
git commit -m "feat(lib): add getLoanRoleForUser shared authorization helper"
```

---

## Task 3: Condition matcher

Pure function that suggests a condition for a given filename. No deps, no I/O. Includes a self-test block at the bottom of the file that throws on regression - runnable as a one-shot via `npx tsx src/lib/match-condition.ts`.

**Files:**
- Create: `src/lib/match-condition.ts`

- [ ] **Step 1: Create the matcher**

```ts
/**
 * Suggests a condition for a filename by substring match on condition titles.
 *
 * Algorithm:
 *   1. Normalize filename: strip extension, lowercase, replace `_-` with spaces, collapse whitespace.
 *   2. For each condition, check if the normalized filename contains the lowercased condition title.
 *   3. Of all matches, return the one with the longest title (most specific wins).
 *   4. Return null if no condition title is a substring.
 *
 * Examples:
 *   "operating_agreement_v2.pdf"           -> "Operating Agreement"     (substring)
 *   "2023_tax_return_borrower.pdf"         -> "Tax Return"              (substring)
 *   "OA_LLC_signed.pdf"                    -> null                      (no title contains "oa")
 *   "Bank Statements - Jan 2024.pdf"       -> "Bank Statements"         (case + space normalization)
 *   "operating_agreement_articles.pdf"     -> "Articles of Incorporation"
 *                                            IF that title is the longer match - tie-break by length.
 */
export function suggestConditionId(
  filename: string,
  conditions: { id: string; title: string }[],
): string | null {
  const normalized = normalize(filename)
  let best: { id: string; titleLength: number } | null = null
  for (const c of conditions) {
    const title = c.title.toLowerCase().trim()
    if (!title) continue
    if (normalized.includes(title)) {
      if (!best || title.length > best.titleLength) {
        best = { id: c.id, titleLength: title.length }
      }
    }
  }
  return best?.id ?? null
}

function normalize(filename: string): string {
  return filename
    .replace(/\.[^/.]+$/, '')   // strip last extension
    .toLowerCase()
    .replace(/[_\-]+/g, ' ')    // underscores/hyphens to spaces
    .replace(/\s+/g, ' ')       // collapse whitespace
    .trim()
}

// ----- Self-test (run via `npx tsx src/lib/match-condition.ts`) -----
// This block runs only when the file is invoked directly, not when imported.
if (require.main === module) {
  const cases: { filename: string; conditions: { id: string; title: string }[]; expected: string | null }[] = [
    {
      filename: 'operating_agreement_v2.pdf',
      conditions: [{ id: 'a', title: 'Operating Agreement' }, { id: 'b', title: 'Tax Return' }],
      expected: 'a',
    },
    {
      filename: '2023_tax_return.pdf',
      conditions: [{ id: 'a', title: 'Operating Agreement' }, { id: 'b', title: 'Tax Return' }],
      expected: 'b',
    },
    {
      filename: 'OA_LLC_signed.pdf',
      conditions: [{ id: 'a', title: 'Operating Agreement' }],
      expected: null,
    },
    {
      filename: 'Bank Statements - Jan 2024.pdf',
      conditions: [{ id: 'a', title: 'Bank Statements' }],
      expected: 'a',
    },
    {
      filename: 'operating_agreement_articles_of_incorporation.pdf',
      conditions: [
        { id: 'short', title: 'Operating Agreement' },
        { id: 'long',  title: 'Articles of Incorporation' },
      ],
      expected: 'long', // longest matching title wins
    },
    {
      filename: 'random_file_no_match.pdf',
      conditions: [{ id: 'a', title: 'Operating Agreement' }],
      expected: null,
    },
    {
      filename: 'Government-Issued Photo ID.pdf',
      conditions: [{ id: 'a', title: 'Government-Issued Photo ID' }],
      expected: 'a',
    },
  ]
  let failed = 0
  for (const tc of cases) {
    const got = suggestConditionId(tc.filename, tc.conditions)
    if (got !== tc.expected) {
      console.error(`FAIL: ${tc.filename} -> ${got}, expected ${tc.expected}`)
      failed++
    }
  }
  if (failed > 0) { console.error(`${failed} of ${cases.length} cases failed`); process.exit(1) }
  console.log(`OK: ${cases.length} cases passed`)
}
```

- [ ] **Step 2: Run the self-test**

Install tsx temporarily if not present, then run:
```bash
npx tsx src/lib/match-condition.ts
```

Expected output: `OK: 7 cases passed`. If any case fails, fix the matcher (not the test cases - the cases reflect the spec).

- [ ] **Step 3: Build to typecheck**

Run: `npm run build`

Expected: build succeeds. The `require.main === module` block uses CommonJS globals; if Next.js complains, swap to `import.meta.url === ...` ESM form or guard with `typeof require !== 'undefined'`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/match-condition.ts
git commit -m "feat(lib): add suggestConditionId filename-to-condition matcher"
```

---

## Task 4: Sign endpoint - POST /api/documents/bulk-upload/sign

Returns N signed Supabase Storage upload URLs for an authenticated caller. Same pattern as the existing `/api/{role}/upload` endpoint but role-agnostic and accepts a list of filenames.

**Files:**
- Create: `src/app/api/documents/bulk-upload/sign/route.ts`

- [ ] **Step 1: Create the route**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from '@/lib/impersonate'
import { getLoanRoleForUser, canBulkUpload } from '@/lib/loan-authorization'

export async function POST(req: NextRequest) {
  const block = await assertNotImpersonating()
  if (block) return block
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { loanId, fileNames } = await req.json()
  if (!loanId || !Array.isArray(fileNames) || fileNames.length === 0) {
    return NextResponse.json({ error: 'Missing loanId or fileNames' }, { status: 400 })
  }
  if (fileNames.length > 50) {
    return NextResponse.json({ error: 'Too many files (max 50 per batch)' }, { status: 400 })
  }

  const adminClient = createAdminClient()
  const role = await getLoanRoleForUser(adminClient, loanId, user.id)
  if (!canBulkUpload(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: loan } = await adminClient
    .from('loans')
    .select('id, property_address')
    .eq('id', loanId)
    .single()
  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })

  function slugify(s: string): string {
    return s.trim().replace(/[^a-zA-Z0-9\s\-]/g, '').replace(/\s+/g, '_').substring(0, 60)
  }

  const addressSlug = slugify(loan.property_address ?? loanId)
  const stamp = Date.now()

  const results: { fileName: string; path: string; signedUrl: string; token: string }[] = []
  for (let i = 0; i < fileNames.length; i++) {
    const original: string = String(fileNames[i])
    const ext = original.includes('.') ? original.split('.').pop() : ''
    const baseName = original.replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9\s\-]/g, '').replace(/\s+/g, '_').substring(0, 40)
    const path = `${addressSlug}/__unmatched/${stamp}_${i}_${baseName}${ext ? '.' + ext : ''}`
    const { data, error } = await adminClient.storage
      .from('documents')
      .createSignedUploadUrl(path)
    if (error || !data) {
      return NextResponse.json({ error: `Sign URL failed for "${original}": ${error?.message}` }, { status: 500 })
    }
    results.push({ fileName: original, path, signedUrl: data.signedUrl, token: data.token })
  }

  return NextResponse.json({ uploads: results })
}
```

- [ ] **Step 2: Build**

Run: `npm run build`

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/documents/bulk-upload/sign/route.ts
git commit -m "feat(api): add POST /api/documents/bulk-upload/sign for N signed URLs"
```

---

## Task 5: Record endpoint - POST /api/documents/bulk-upload/record

Inserts N rows into `documents` with `condition_id = NULL` after the client has uploaded the files. Returns the new rows plus a suggested condition for each (computed server-side via the matcher).

**Files:**
- Create: `src/app/api/documents/bulk-upload/record/route.ts`

- [ ] **Step 1: Create the route**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from '@/lib/impersonate'
import { getLoanRoleForUser, canBulkUpload } from '@/lib/loan-authorization'
import { suggestConditionId } from '@/lib/match-condition'

type IncomingFile = { fileName: string; fileSize: number | null; path: string }

export async function POST(req: NextRequest) {
  const block = await assertNotImpersonating()
  if (block) return block
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { loanId, files } = (await req.json()) as { loanId?: string; files?: IncomingFile[] }
  if (!loanId || !Array.isArray(files) || files.length === 0) {
    return NextResponse.json({ error: 'Missing loanId or files' }, { status: 400 })
  }

  const adminClient = createAdminClient()
  const role = await getLoanRoleForUser(adminClient, loanId, user.id)
  if (!canBulkUpload(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rows = files.map(f => ({
    loan_id: loanId,
    condition_id: null,
    uploaded_by_user_id: user.id,
    file_name: f.fileName,
    file_path: f.path,
    file_size: f.fileSize ?? null,
  }))

  const { data: inserted, error } = await adminClient
    .from('documents')
    .insert(rows)
    .select('id, file_name, file_path, file_size, created_at')

  if (error || !inserted) {
    return NextResponse.json({ error: `Insert failed: ${error?.message}` }, { status: 500 })
  }

  // Load conditions for matching.
  const { data: conditions } = await adminClient
    .from('conditions')
    .select('id, title')
    .eq('loan_id', loanId)

  const safeConditions = conditions ?? []
  const documents = inserted.map(d => ({
    ...d,
    suggested_condition_id: suggestConditionId(d.file_name, safeConditions),
  }))

  // Audit log (best-effort).
  try {
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'documents_bulk_uploaded',
      description: `${role!.role} bulk-uploaded ${inserted.length} document(s) (unmatched)`,
    })
  } catch (err) { console.error('Event log error:', err) }

  return NextResponse.json({ documents })
}
```

- [ ] **Step 2: Build**

Run: `npm run build`

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/documents/bulk-upload/record/route.ts
git commit -m "feat(api): add POST /api/documents/bulk-upload/record with suggestions"
```

---

## Task 6: Match endpoint - PATCH /api/documents/[id]/match

Updates a single document's `condition_id`. Pass `null` to un-match.

**Files:**
- Create: `src/app/api/documents/[id]/match/route.ts`

- [ ] **Step 1: Create the route**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from '@/lib/impersonate'
import { getLoanRoleForUser, isStaff } from '@/lib/loan-authorization'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const block = await assertNotImpersonating()
  if (block) return block
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { condition_id } = await req.json() as { condition_id: string | null }

  const adminClient = createAdminClient()

  const { data: doc } = await adminClient
    .from('documents')
    .select('id, loan_id, uploaded_by_user_id, condition_id')
    .eq('id', id)
    .maybeSingle()
  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const role = await getLoanRoleForUser(adminClient, doc.loan_id, user.id)
  if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Borrowers can only match documents they uploaded.
  if (role.role === 'borrower' && doc.uploaded_by_user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // If setting a condition_id, verify it belongs to this loan.
  if (condition_id !== null) {
    const { data: condition } = await adminClient
      .from('conditions')
      .select('id, loan_id, title, status')
      .eq('id', condition_id)
      .maybeSingle()
    if (!condition || condition.loan_id !== doc.loan_id) {
      return NextResponse.json({ error: 'Condition not on this loan' }, { status: 400 })
    }
    // Flip condition status from Outstanding/Rejected to Received, matching existing upload-record behavior.
    if (condition.status === 'Outstanding' || condition.status === 'Rejected') {
      await adminClient.from('conditions').update({ status: 'Received' }).eq('id', condition.id)
    }
  }

  const { error } = await adminClient
    .from('documents')
    .update({ condition_id })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  try {
    await adminClient.from('loan_events').insert({
      loan_id: doc.loan_id,
      event_type: condition_id ? 'document_matched' : 'document_unmatched',
      description: condition_id
        ? `${role.role} matched document ${id} to condition ${condition_id}`
        : `${role.role} un-matched document ${id}`,
    })
  } catch (err) { console.error('Event log error:', err) }

  return NextResponse.json({ success: true })
}
```

- [ ] **Step 2: Build**

Run: `npm run build`

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/documents/\[id\]/match/route.ts
git commit -m "feat(api): add PATCH /api/documents/[id]/match"
```

---

## Task 7: Unmatched-list endpoint - GET /api/loans/[id]/documents/unmatched

Returns the unmatched documents on a loan, scoped by role: borrowers see only their own uploads; staff see everything.

**Files:**
- Create: `src/app/api/loans/[id]/documents/unmatched/route.ts`

- [ ] **Step 1: Create the route**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from '@/lib/impersonate'
import { getLoanRoleForUser } from '@/lib/loan-authorization'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const block = await assertNotImpersonating()
  if (block) return block
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: loanId } = await params

  const adminClient = createAdminClient()
  const role = await getLoanRoleForUser(adminClient, loanId, user.id)
  if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let query = adminClient
    .from('documents')
    .select('id, file_name, file_path, file_size, uploaded_by_user_id, created_at')
    .eq('loan_id', loanId)
    .is('condition_id', null)
    .order('created_at', { ascending: false })

  if (role.role === 'borrower') {
    query = query.eq('uploaded_by_user_id', user.id)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ documents: data ?? [] })
}
```

- [ ] **Step 2: Build**

Run: `npm run build`

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/loans/\[id\]/documents/unmatched/route.ts
git commit -m "feat(api): add GET /api/loans/[id]/documents/unmatched"
```

---

## Task 8: Unmatched documents card component

Collapsible card that lists unmatched documents on the loan. Used by all four role-specific condition views. Renders nothing if there are zero matches.

**Files:**
- Create: `src/components/unmatched-documents-card.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { CollapsibleCard } from '@/components/collapsible-card'
import { Button } from '@/components/ui/button'

export type UnmatchedDoc = {
  id: string
  file_name: string
  file_path: string
  file_size: number | null
  uploaded_by_user_id: string | null
  created_at: string
}

type Props = {
  loanId: string
  onMatchClick: (docs: UnmatchedDoc[]) => void  // opens parent's bulk modal in re-entry mode
  refreshKey?: number                            // bump to trigger re-fetch
}

export function UnmatchedDocumentsCard({ loanId, onMatchClick, refreshKey }: Props) {
  const [docs, setDocs] = useState<UnmatchedDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/loans/${loanId}/documents/unmatched`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setDocs(data.documents ?? []) })
      .catch(() => { if (!cancelled) setError('Could not load unmatched documents') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [loanId, refreshKey])

  async function handleDelete(docId: string, fileName: string) {
    if (!confirm(`Delete "${fileName}"? This cannot be undone.`)) return
    setDeletingId(docId)
    setError(null)
    const res = await fetch('/api/documents', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId: docId }),
    })
    const data = await res.json().catch(() => ({}))
    if (data.success) {
      setDocs(prev => prev.filter(d => d.id !== docId))
    } else {
      setError(data.error ?? `Failed to delete "${fileName}"`)
    }
    setDeletingId(null)
  }

  if (loading) return null
  if (docs.length === 0) return null

  return (
    <CollapsibleCard title={`Unmatched documents (${docs.length})`} defaultOpen>
      {error && <div className="text-sm text-red-600 mb-2">{error}</div>}
      <ul className="divide-y divide-gray-200">
        {docs.map(d => (
          <li key={d.id} className="py-2 flex items-center gap-3">
            <span className="flex-1 truncate text-sm" title={d.file_name}>{d.file_name}</span>
            <span className="text-xs text-gray-500">{new Date(d.created_at).toLocaleDateString()}</span>
            <Button size="sm" variant="outline" onClick={() => onMatchClick([d])}>Match</Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={deletingId === d.id}
              onClick={() => handleDelete(d.id, d.file_name)}
            >
              {deletingId === d.id ? 'Deleting...' : 'Delete'}
            </Button>
          </li>
        ))}
      </ul>
      {docs.length > 1 && (
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={() => onMatchClick(docs)}>Match all</Button>
        </div>
      )}
    </CollapsibleCard>
  )
}
```

- [ ] **Step 2: Build**

Run: `npm run build`

Expected: build succeeds. If `CollapsibleCard` props differ from the assumed signature, adjust the JSX (check `src/components/collapsible-card.tsx`).

- [ ] **Step 3: Commit**

```bash
git add src/components/unmatched-documents-card.tsx
git commit -m "feat(ui): add UnmatchedDocumentsCard component"
```

---

## Task 9: Bulk upload modal

The two-column matcher modal. Two modes:
- **Fresh upload mode** (default): shows a dropzone first; on drop, signs URLs, uploads to storage, records rows, then switches to the matcher view.
- **Re-entry mode** (when opened from the Unmatched card): skips the dropzone and goes straight to the matcher with the passed-in docs.

The matcher view has two columns: files on the left (with status pills), conditions on the right (grouped by category). HTML5 drag-and-drop for assignment. Footer commits assignments via `PATCH /api/documents/[id]/match`.

This is the largest file in the plan. Break the implementation into sub-steps within the same task.

**Files:**
- Create: `src/components/bulk-upload-modal.tsx`

- [ ] **Step 1: Create the file with imports, types, and the shell**

```tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import type { Condition, ConditionCategory } from '@/lib/types'
import { CONDITION_CATEGORIES } from '@/lib/types'

export type BulkDoc = {
  id: string
  file_name: string
  file_path: string
  file_size: number | null
  suggested_condition_id: string | null
  /** UI-only: which condition the user has confirmed (null = staying unmatched). */
  staged_condition_id: string | null
  /** UI-only: has the user explicitly confirmed (vs. raw suggestion)? */
  confirmed: boolean
}

type Props = {
  loanId: string
  conditions: Condition[]
  open: boolean
  onClose: () => void
  /** When provided, modal opens directly in matcher mode with these docs. */
  initialDocs?: BulkDoc[]
  /** Called after a successful save so the parent can refresh data. */
  onSaved?: () => void
}

export function BulkUploadModal({ loanId, conditions, open, onClose, initialDocs, onSaved }: Props) {
  const [phase, setPhase] = useState<'drop' | 'match'>(initialDocs && initialDocs.length > 0 ? 'match' : 'drop')
  const [docs, setDocs] = useState<BulkDoc[]>(initialDocs ?? [])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setPhase(initialDocs && initialDocs.length > 0 ? 'match' : 'drop')
    setDocs(initialDocs ?? [])
    setUploadError(null)
    setSaveError(null)
  }, [open, initialDocs])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        <header className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {phase === 'drop' ? 'Bulk upload documents' : 'Match documents to conditions'}
          </h2>
          <button
            onClick={() => { if (!uploading) onClose() }}
            className="text-gray-500 hover:text-gray-700"
            aria-label="Close"
            disabled={uploading}
          >
            X
          </button>
        </header>
        {phase === 'drop'
          ? <DropPhase
              loanId={loanId}
              uploading={uploading}
              setUploading={setUploading}
              error={uploadError}
              setError={setUploadError}
              onUploaded={uploaded => { setDocs(uploaded); setPhase('match') }}
            />
          : <MatchPhase
              docs={docs}
              setDocs={setDocs}
              conditions={conditions}
              saving={saving}
              error={saveError}
              onCancel={onClose}
              onSave={async () => {
                setSaving(true); setSaveError(null)
                const toCommit = docs.filter(d => d.confirmed)
                const results = await Promise.all(toCommit.map(d =>
                  fetch(`/api/documents/${d.id}/match`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ condition_id: d.staged_condition_id }),
                  }).then(r => r.json()).catch(() => ({ success: false }))
                ))
                const failed = results.filter(r => !r.success).length
                setSaving(false)
                if (failed > 0) {
                  setSaveError(`${failed} of ${toCommit.length} matches failed`)
                  return
                }
                onSaved?.()
                onClose()
              }}
            />
        }
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add the DropPhase sub-component (within the same file, below `BulkUploadModal`)**

```tsx
function DropPhase({
  loanId, uploading, setUploading, error, setError, onUploaded,
}: {
  loanId: string
  uploading: boolean
  setUploading: (v: boolean) => void
  error: string | null
  setError: (e: string | null) => void
  onUploaded: (docs: BulkDoc[]) => void
}) {
  const [dragging, setDragging] = useState(false)

  async function handleFiles(files: File[]) {
    if (files.length === 0) return
    setUploading(true); setError(null)
    try {
      // 1. Get signed URLs.
      const signRes = await fetch('/api/documents/bulk-upload/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId, fileNames: files.map(f => f.name) }),
      })
      const signData = await signRes.json()
      if (!signRes.ok) { setError(signData.error ?? 'Could not start upload'); setUploading(false); return }
      const supabase = createClient()

      // 2. Upload each file to storage.
      const uploaded: { fileName: string; fileSize: number; path: string }[] = []
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const upload = signData.uploads[i]
        const { error: upErr } = await supabase.storage.from('documents').uploadToSignedUrl(
          upload.path, upload.token, file,
          { contentType: file.type || 'application/octet-stream' },
        )
        if (upErr) { setError(`"${file.name}" upload failed: ${upErr.message}`); setUploading(false); return }
        uploaded.push({ fileName: file.name, fileSize: file.size, path: upload.path })
      }

      // 3. Record rows + get suggestions.
      const recRes = await fetch('/api/documents/bulk-upload/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId, files: uploaded }),
      })
      const recData = await recRes.json()
      if (!recRes.ok) { setError(recData.error ?? 'Could not save documents'); setUploading(false); return }

      const docs: BulkDoc[] = recData.documents.map((d: { id: string; file_name: string; file_path: string; file_size: number | null; suggested_condition_id: string | null }) => ({
        id: d.id,
        file_name: d.file_name,
        file_path: d.file_path,
        file_size: d.file_size,
        suggested_condition_id: d.suggested_condition_id,
        staged_condition_id: d.suggested_condition_id, // auto-stage suggestions
        confirmed: false,                              // user still needs to confirm
      }))
      setUploading(false)
      onUploaded(docs)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
      setUploading(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col p-6">
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault(); setDragging(false)
          handleFiles(Array.from(e.dataTransfer.files))
        }}
        className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${dragging ? 'border-primary bg-primary/5' : 'border-gray-300'}`}
      >
        <p className="text-gray-700 mb-2">{uploading ? 'Uploading...' : 'Drop files here'}</p>
        <p className="text-sm text-gray-500 mb-4">or</p>
        <label className="inline-block">
          <input
            type="file"
            multiple
            className="hidden"
            disabled={uploading}
            onChange={e => handleFiles(Array.from(e.target.files ?? []))}
          />
          <span className="inline-block px-4 py-2 rounded bg-primary text-white cursor-pointer hover:bg-primary/90">
            Browse files
          </span>
        </label>
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
      <p className="mt-3 text-xs text-gray-500 text-center">
        Files are saved immediately. You can close this window and finish matching later from the Unmatched documents card.
      </p>
    </div>
  )
}
```

- [ ] **Step 3: Add the MatchPhase sub-component (still in the same file)**

```tsx
function MatchPhase({
  docs, setDocs, conditions, saving, error, onCancel, onSave,
}: {
  docs: BulkDoc[]
  setDocs: (updater: (prev: BulkDoc[]) => BulkDoc[]) => void
  conditions: Condition[]
  saving: boolean
  error: string | null
  onCancel: () => void
  onSave: () => void
}) {
  const grouped = useMemo(() => {
    const g: Record<ConditionCategory | 'uncategorized', Condition[]> = {
      initial: [], underwriting: [], pre_close: [], pre_funding: [], uncategorized: [],
    }
    for (const c of conditions) {
      const key = (c.category ?? 'uncategorized') as keyof typeof g
      g[key].push(c)
    }
    return g
  }, [conditions])

  const conditionById = useMemo(() => new Map(conditions.map(c => [c.id, c])), [conditions])

  function stageOnCondition(docId: string, conditionId: string | null) {
    setDocs(prev => prev.map(d =>
      d.id === docId
        ? { ...d, staged_condition_id: conditionId, confirmed: conditionId !== null }
        : d
    ))
  }

  function confirmedCount(): number {
    return docs.filter(d => d.confirmed).length
  }

  return (
    <>
      <div className="flex-1 grid grid-cols-2 gap-4 p-6 overflow-hidden">
        {/* Left column: files */}
        <section className="flex flex-col overflow-hidden">
          <h3 className="text-sm font-semibold mb-2">Files to match ({docs.length})</h3>
          <ul className="flex-1 overflow-y-auto space-y-2 pr-2">
            {docs.map(d => {
              const matched = d.staged_condition_id ? conditionById.get(d.staged_condition_id) : null
              const pillClass = d.confirmed
                ? 'bg-green-100 text-green-800'
                : d.staged_condition_id
                  ? 'bg-yellow-100 text-yellow-800'
                  : 'bg-gray-100 text-gray-700'
              const pillText = d.confirmed
                ? `Confirmed: ${matched?.title ?? '...'}`
                : d.staged_condition_id
                  ? `Auto-matched: ${matched?.title ?? '...'}`
                  : 'Unmatched'
              return (
                <li
                  key={d.id}
                  draggable
                  onDragStart={e => e.dataTransfer.setData('text/plain', d.id)}
                  className="border rounded p-2 bg-white cursor-grab"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate text-sm" title={d.file_name}>{d.file_name}</span>
                    {d.staged_condition_id && !d.confirmed && (
                      <Button size="sm" variant="outline" onClick={() => stageOnCondition(d.id, d.staged_condition_id)}>
                        Confirm
                      </Button>
                    )}
                    {d.staged_condition_id && (
                      <Button size="sm" variant="ghost" onClick={() => stageOnCondition(d.id, null)} aria-label="Clear match">
                        x
                      </Button>
                    )}
                  </div>
                  <div className="mt-1">
                    <span className={`inline-block text-xs px-2 py-0.5 rounded ${pillClass}`}>{pillText}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>

        {/* Right column: conditions */}
        <section className="flex flex-col overflow-hidden">
          <h3 className="text-sm font-semibold mb-2">Conditions</h3>
          <div className="flex-1 overflow-y-auto pr-2 space-y-4">
            {CONDITION_CATEGORIES.map(cat => {
              const list = grouped[cat.value] ?? []
              if (list.length === 0) return null
              return (
                <div key={cat.value}>
                  <h4 className="text-xs uppercase text-gray-500 mb-1">{cat.label}</h4>
                  <ul className="space-y-1">
                    {list.map(c => {
                      const staged = docs.filter(d => d.staged_condition_id === c.id)
                      return (
                        <li
                          key={c.id}
                          onDragOver={e => e.preventDefault()}
                          onDrop={e => {
                            e.preventDefault()
                            const docId = e.dataTransfer.getData('text/plain')
                            if (docId) stageOnCondition(docId, c.id)
                          }}
                          className="border rounded p-2 bg-white"
                        >
                          <div className="text-sm font-medium">{c.title}</div>
                          {staged.length > 0 && (
                            <ul className="mt-1 ml-2 text-xs text-gray-700 space-y-0.5">
                              {staged.map(d => (
                                <li key={d.id} className="flex items-center gap-2">
                                  <span className="flex-1 truncate">{d.file_name}</span>
                                  <button
                                    onClick={() => stageOnCondition(d.id, null)}
                                    className="text-gray-400 hover:text-gray-700"
                                    aria-label="Remove"
                                  >x</button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      <footer className="px-6 py-4 border-t flex items-center justify-between">
        <div className="text-sm">
          {error && <span className="text-red-600">{error}</span>}
          {!error && <span className="text-gray-600">{confirmedCount()} of {docs.length} confirmed</span>}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>Close</Button>
          <Button onClick={onSave} disabled={saving || confirmedCount() === 0}>
            {saving ? 'Saving...' : `Save ${confirmedCount()} match${confirmedCount() === 1 ? '' : 'es'}`}
          </Button>
        </div>
      </footer>
    </>
  )
}
```

- [ ] **Step 4: Build**

Run: `npm run build`

Expected: build succeeds. If types/exports for `Condition`, `CONDITION_CATEGORIES`, or `Button` differ from assumed, adjust imports.

- [ ] **Step 5: Commit**

```bash
git add src/components/bulk-upload-modal.tsx
git commit -m "feat(ui): add BulkUploadModal with drop + two-column matcher"
```

---

## Task 10: Wire the bulk upload button + Unmatched card into all four role-specific condition views

Each role's conditions component gets two additions: a "Bulk Upload" button at the top of its toolbar, and an `<UnmatchedDocumentsCard>` mounted above the existing condition sections. The modal state (open/closed, optional pre-populated docs for re-entry) lives in each component. A shared local `refreshKey` increments on save to re-fetch unmatched docs.

**Files:**
- Modify: `src/components/loan-processor-conditions.tsx`
- Modify: `src/components/underwriter-conditions.tsx`
- Modify: `src/components/loan-officer-conditions.tsx`
- Modify: `src/components/conditions-list.tsx` (borrower view)

- [ ] **Step 1: Add the integration to `loan-processor-conditions.tsx`**

At the top of the component, near the other `useState` declarations (around line 437), add:
```tsx
const [bulkModalOpen, setBulkModalOpen] = useState(false)
const [bulkInitialDocs, setBulkInitialDocs] = useState<BulkDoc[] | undefined>(undefined)
const [unmatchedRefreshKey, setUnmatchedRefreshKey] = useState(0)
```

Add to imports at the top of the file:
```tsx
import { BulkUploadModal, type BulkDoc } from '@/components/bulk-upload-modal'
import { UnmatchedDocumentsCard, type UnmatchedDoc } from '@/components/unmatched-documents-card'
import { suggestConditionId } from '@/lib/match-condition'
```

In the JSX, place the Bulk Upload button as a sibling to the existing "Add Condition" / template toolbar buttons (search for "Add Condition" in the file to find the row). Mount the Unmatched card just above the first CollapsibleCard / conditions section, and the modal at the bottom of the component tree:

```tsx
{/* Toolbar - place next to existing Add Condition button */}
<Button variant="outline" onClick={() => { setBulkInitialDocs(undefined); setBulkModalOpen(true) }}>
  Bulk Upload
</Button>

{/* Above the conditions sections */}
<UnmatchedDocumentsCard
  loanId={loanId}
  refreshKey={unmatchedRefreshKey}
  onMatchClick={(unmatchedDocs: UnmatchedDoc[]) => {
    // Re-run the matcher client-side so suggestions appear without a server round-trip.
    const titles = conditions.map(c => ({ id: c.id, title: c.title }))
    setBulkInitialDocs(unmatchedDocs.map(u => {
      const suggested = suggestConditionId(u.file_name, titles)
      return {
        id: u.id,
        file_name: u.file_name,
        file_path: u.file_path,
        file_size: u.file_size,
        suggested_condition_id: suggested,
        staged_condition_id: suggested,
        confirmed: false,
      }
    }))
    setBulkModalOpen(true)
  }}
/>

{/* Bottom of the component tree */}
<BulkUploadModal
  loanId={loanId}
  conditions={conditions}
  open={bulkModalOpen}
  onClose={() => setBulkModalOpen(false)}
  initialDocs={bulkInitialDocs}
  onSaved={() => { setUnmatchedRefreshKey(k => k + 1); router.refresh() }}
/>
```

- [ ] **Step 2: Repeat the same integration in `underwriter-conditions.tsx`**

Same code, same locations (the component structure is parallel - imports, useState block, JSX). The only difference is the existing toolbar location; place the "Bulk Upload" button next to the existing Add/Template controls.

- [ ] **Step 3: Repeat in `loan-officer-conditions.tsx`**

Same code, same locations.

- [ ] **Step 4: Repeat in `conditions-list.tsx` (borrower)**

Same code. The borrower view is simpler - the button can live at the top of the conditions list, and the Unmatched card sits above it. Borrower will only see their own uploads in the card (server enforces this).

- [ ] **Step 5: Build**

Run: `npm run build`

Expected: build succeeds. Type errors here are most likely from the `Condition` shape passed to `<BulkUploadModal conditions={conditions} />` - all four call sites already have a `conditions` array of the right shape.

- [ ] **Step 6: Commit**

```bash
git add src/components/loan-processor-conditions.tsx src/components/underwriter-conditions.tsx src/components/loan-officer-conditions.tsx src/components/conditions-list.tsx
git commit -m "feat(ui): wire bulk upload button + Unmatched card into all role views"
```

---

## Task 11: Run dev server and exercise the flow with Playwright

Drive the full flow as a loan processor first (the original requester), then as a borrower (visibility check), then as an underwriter (to confirm staff visibility).

**Files:** none

- [ ] **Step 1: Start the dev server in the worktree**

Run (in the worktree directory): `npm run dev -- -p 3100`

Expected: server starts at http://localhost:3100. Leave it running (use `run_in_background: true` if scripted).

- [ ] **Step 2: Drive the LP flow with Playwright**

Use `mcp__plugin_playwright_playwright__browser_*` tools to:
1. Sign in as the LP test user.
2. Navigate to a loan with several conditions including "Operating Agreement", "Tax Return", "Bank Statements".
3. Click "Bulk Upload" - confirm modal opens in drop mode.
4. Upload 5 test files: `operating_agreement.pdf`, `tax_return_2023.pdf`, `bank_statements_jan.pdf`, `random_file.pdf`, `OA_LLC_signed.pdf`.
5. Confirm modal switches to match mode and shows: 3 auto-matched, 2 unmatched.
6. Drag `random_file.pdf` onto a condition.
7. Click `Confirm` on the auto-matches.
8. Click `Save matches`. Modal closes.
9. Confirm conditions list now shows the matched files attached to their conditions.
10. Refresh the page. Confirm the Unmatched card shows the 1 still-unmatched file (`OA_LLC_signed.pdf`).

Capture screenshots at steps 3, 5, 9, 10.

- [ ] **Step 3: Drive the borrower flow**

Sign out, sign in as the borrower for the same loan, navigate to their portal. Confirm:
- Bulk Upload button is present.
- Unmatched card shows 0 (borrower did not upload `OA_LLC_signed.pdf`; LP did) - it is hidden.
- Bulk uploading from borrower side creates rows visible to staff but not to other borrowers.

- [ ] **Step 4: Drive the UW flow**

Sign in as UW. Confirm Unmatched card shows the LP's unmatched file. Click Match, sort it via the matcher.

- [ ] **Step 5: No commit (verification-only task)**

---

## Task 12: Run playwright-role-gates

The user's project skill `playwright-role-gates` drives each of the five sign-ins (admin, LO, LP, UW, borrower) and confirms each role can only reach their permitted routes. Run it to catch any role-check regression introduced by the new API routes.

**Files:** none

- [ ] **Step 1: Invoke the skill**

Use the `Skill` tool with `skill: "playwright-role-gates"`. Follow the skill's instructions to drive each role.

- [ ] **Step 2: Specifically verify the new endpoints**

For each role, attempt:
- `POST /api/documents/bulk-upload/sign` with another loan's id -> 403
- `PATCH /api/documents/[id]/match` on a doc not on their loan -> 403
- Borrower attempting to match a doc uploaded by someone else -> 403
- `GET /api/loans/[id]/documents/unmatched` for a loan they're not on -> 403

- [ ] **Step 3: No commit (verification-only task)**

---

## Task 13: Preview deploy and final verification

Per the user's verification policy, preview deploy is the highest-signal step for a feature this size.

**Files:** none

- [ ] **Step 1: Push the branch to origin**

```bash
git push -u origin <branch-name>
```

Expected: Vercel auto-builds a preview deploy from the push.

- [ ] **Step 2: Verify the deploy succeeded**

Use the GitHub deployments API (per project memory - Vercel MCP can't see this project):
```bash
gh api repos/<owner>/<repo>/deployments | jq '.[0]'
```

Expected: latest deployment for the branch has `state: success`.

- [ ] **Step 3: Walk through the LP flow on the preview URL**

Repeat Task 11 steps 1-10 against the preview deploy URL. Capture screenshots.

- [ ] **Step 4: Hand off**

Report back with:
- Preview URL
- Screenshots from the walkthrough
- Confirmation that all 5 success criteria from the spec are met

---

## Self-review checklist (run before handing off the plan)

- [ ] **Spec coverage:** Every spec section maps to at least one task above (migration -> Task 1; matching algorithm -> Task 3; APIs -> Tasks 4-7; UI -> Tasks 8-10; verification -> Tasks 11-13).
- [ ] **Placeholder scan:** No TBD / TODO / "fill in" left in the plan.
- [ ] **Type consistency:** `BulkDoc`, `UnmatchedDoc`, `LoanRole` are defined once and referenced by the same name in every task that uses them.
- [ ] **Path consistency:** All paths use forward slashes; file paths in commands escape brackets for bash where needed.
- [ ] **Auth coverage:** Every new API route resolves the caller's role and the loan membership before any DB write. Task 12 verifies this from the outside.
