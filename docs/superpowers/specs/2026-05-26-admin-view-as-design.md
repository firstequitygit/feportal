# Admin "View As" — Design

**Date:** 2026-05-26
**Status:** Approved (brainstorm); pending implementation plan.
**Author:** apalmiotto + Claude

## Problem

Admins need to assume the perspective of any specific user (loan officer, loan processor, underwriter, broker, borrower) and see that user's entire portal exactly as they see it. Two use cases:

1. **Support** — help a user navigate the portal by seeing what they see.
2. **QA** — verify new features work for each role without juggling test accounts.

## What exists today

Loan-scoped impersonation already works:

- `src/lib/impersonate.ts` — `resolveImpersonation()` supports all five `?as_*` query-param kinds.
- `src/components/view-as-dropdown.tsx` — per-loan dropdown on loan detail pages.
- `src/components/impersonation-banner.tsx` — yellow "Admin preview" banner with Exit link.
- `/dashboard` and `/broker` home pages honor `?as_borrower=` / `?as_broker=`.

## What is missing

1. No global picker — admin can't jump into a user's full portal without first opening one of their loans.
2. `/loan-officer/inbox`, `/loan-processor/inbox`, `/underwriter/inbox` (and the role-tree pages beneath them) fetch the role row by `auth_user_id` only, ignoring any impersonation signal.
3. No read-only enforcement — the current per-loan impersonation lets the admin click any mutation button as if they were the user.

## Decisions

| Question | Decision |
|---|---|
| Where does the picker live? | Header button (left of the logo), admin-only, opens a command-palette modal. |
| Picker shape? | Searchable combobox, all roles grouped (LOs, LPs, UWs, Brokers, Borrowers). Staff + brokers preloaded; borrowers searched on-demand at 200ms debounce. |
| Audit? | One row in a new `admin_impersonation_events` table on start; `ended_at` filled on exit. No per-page logging. |
| Exit behavior? | Back to `/admin`. |
| Action scope while impersonating? | Read-only — UI mutation controls disabled AND API mutation routes return 403. |
| Trigger? | Header button click OR `Cmd/Ctrl+K` shortcut. |

## Architecture

State of impersonation lives in a signed HTTP-only cookie `fe_view_as` plus the audit table. The cookie is read on every request, which lets the banner persist across navigation and lets API routes reject mutations without needing query-param awareness.

The existing `?as_*` query-param path stays for the per-loan dropdown (legacy compat). `resolveImpersonation()` reads the cookie first, falls back to the query params.

```
┌────────────────────┐
│  Admin header      │   click "View as" or Cmd/Ctrl+K
│  ┌──────────────┐  │
│  │ View as  ▾   │──┼──> opens command-palette modal
│  └──────────────┘  │
└────────────────────┘
          │ select Jane (LO)
          ▼
POST /api/admin/view-as/start { kind: 'loan_officer', id: <jane.id> }
  → insert admin_impersonation_events row
  → set signed cookie fe_view_as
  → return { redirectTo: '/loan-officer/inbox' }
          │
          ▼
GET /loan-officer/inbox
  → resolveImpersonation(cookies) returns { kind: 'loan_officer', id: jane.id, ... }
  → page fetches Jane's pipeline (her loans, her conditions)
  → ImpersonationBanner renders at top
  → ImpersonationProvider sets isImpersonating=true in React context
          │
          │ Admin clicks "Send Email" (a mutation button)
          ▼
Button reads useImpersonation() → renders disabled with tooltip
"Read-only preview — exit View As to act"
          │
          │ If they bypass UI and POST anyway:
          ▼
POST /api/loans/status (or any mutation route)
  → assertNotImpersonating(cookies) → 403
          │
          │ Admin clicks "Exit preview"
          ▼
POST /api/admin/view-as/exit
  → update ended_at on most recent open row
  → clear cookie
  → redirect to /admin
```

## Database

New table:

```sql
create table admin_impersonation_events (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid not null references admin_users(id),
  target_kind  text not null check (target_kind in
                ('borrower','broker','loan_officer','loan_processor','underwriter')),
  target_id    uuid not null,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  user_agent   text
);
create index on admin_impersonation_events (admin_id, started_at desc);
```

`target_id` is a soft FK (no constraint) because it points to one of five different tables depending on `target_kind`. RLS not needed on this table — it's only written by service-role API routes.

## Server changes

### New API routes

| Route | Method | Behavior |
|---|---|---|
| `/api/admin/view-as/people` | GET | Returns `{loan_officers, loan_processors, underwriters, brokers}` arrays. Admin-only. |
| `/api/admin/view-as/search` | GET `?q=...&kind=borrower` | Borrower-specific ILIKE search on `full_name` + `email`. Top 20. Admin-only. |
| `/api/admin/view-as/start` | POST `{kind, id}` | Inserts `admin_impersonation_events` row, sets signed `fe_view_as` cookie, returns `{redirectTo}`. |
| `/api/admin/view-as/exit` | POST | Updates `ended_at` on the most recent open row for this admin, clears cookie, returns `{redirectTo: '/admin'}`. |

Redirect targets from `start`:
- `borrower` → `/dashboard`
- `broker` → `/broker`
- `loan_officer` → `/loan-officer/inbox`
- `loan_processor` → `/loan-processor/inbox`
- `underwriter` → `/underwriter/inbox`

### Cookie

- Name: `fe_view_as`
- Format: signed JSON, HMAC-SHA256 with a new env var `VIEW_AS_SECRET` (or reuse an existing app secret).
- Payload: `{ kind, target_id, admin_id, started_at }`
- Flags: `httpOnly`, `sameSite=lax`, `secure` in prod, no explicit expiry (session cookie).

### Extensions to `src/lib/impersonate.ts`

```ts
// New: cookie-first resolution.
export async function resolveImpersonation(...): Promise<ImpersonationContext | null> {
  const c = await cookies()
  const cookieCtx = readSignedViewAsCookie(c.get('fe_view_as')?.value)
  if (cookieCtx && await isAdmin(supa, cookieCtx.admin_id)) {
    return { ...cookieCtx, impersonatorRole: 'admin' }
  }
  // Existing query-param fallback for the per-loan dropdown.
  return resolveFromQueryParams(...)
}

// New helper used by mutation routes.
export async function assertNotImpersonating(): Promise<NextResponse | null> {
  const c = await cookies()
  if (c.get('fe_view_as')) {
    return NextResponse.json(
      { error: 'Read-only preview: exit View As to make changes.' },
      { status: 403 }
    )
  }
  return null
}

// New helper for role pages.
export async function getEffectiveRoleRow(
  supa: Admin,
  kind: 'loan_officer' | 'loan_processor' | 'underwriter',
  authUserId: string,
): Promise<RoleRow | null> {
  const ctx = await resolveImpersonation(supa, authUserId, undefined)
  if (ctx?.kind === kind) {
    return supa.from(tableFor(kind)).select('*').eq('id', ctx.id).maybeSingle().then(r => r.data)
  }
  return supa.from(tableFor(kind)).select('*').eq('auth_user_id', authUserId).maybeSingle().then(r => r.data)
}
```

### Role pages patched

The role home pages all use the same pattern: `from(roleTable).select('*').eq('auth_user_id', user.id).single()`. They get replaced with `getEffectiveRoleRow()`. Per the earlier survey:

- `src/app/loan-officer/inbox/page.tsx`
- `src/app/loan-officer/loans/page.tsx`
- `src/app/loan-officer/loans/[id]/page.tsx`
- `src/app/loan-officer/archived/page.tsx`
- `src/app/loan-officer/conditions/page.tsx`
- `src/app/loan-officer/borrowers/page.tsx`
- `src/app/loan-officer/brokers/page.tsx`
- `src/app/loan-officer/vendors/page.tsx`
- `src/app/loan-officer/page.tsx`
- (same 9 patterns for `loan-processor/`, plus `templates/`)
- (same patterns for `underwriter/` — 5 pages)
- `/dashboard/page.tsx` and `/broker/page.tsx` already work via query params; extended to also read the cookie.

## UI: command-palette modal

### New deps

- `cmdk` (~12KB gzipped) — the headless command primitive used by Linear/Vercel/GitHub's cmd-K UX.
- shadcn primitives `Command` and `Dialog` — installed via `npx shadcn add command dialog`.

### New components

**`src/components/admin-view-as-trigger.tsx`** (client component)
- Renders a small "View as" button in the PortalShell header (left of the logo, only when current user is admin).
- Owns the modal open/close state.
- Listens for `Cmd/Ctrl+K` global keyboard shortcut.
- Lazy-loads the modal contents on first open.

**`src/components/admin-view-as-modal.tsx`** (client component)
- Wraps shadcn `<CommandDialog>` (cmdk-powered).
- On mount: fetches `/api/admin/view-as/people` once and caches.
- Search input is autofocus.
- When query is non-empty, also debounce-fires `/api/admin/view-as/search?kind=borrower&q=<q>` and renders borrower matches under a separate "Borrowers" group.
- Sections rendered in order: Loan Officers, Loan Processors, Underwriters, Brokers, Borrowers. Each row shows name + small badge (role) + optional hint (company name for brokers, email for borrowers).
- On selection: `POST /api/admin/view-as/start` → on success `router.push(redirectTo)`.

**Render location:**

`src/components/portal-shell.tsx`, header section (lines ~127-147 today). Add the trigger component before the `<div className="ml-auto pr-5">` logo block. Visibility gated on a new `isAdmin` prop passed in from the server-rendered page (or read via a session helper).

### Banner

Existing `ImpersonationBanner` already handles all five kinds and the no-loanId exit href returning `/admin`. No changes needed.

## Read-only enforcement

### Layer 1 — API guard (blanket)

Every mutation route adds two lines:

```ts
const block = await assertNotImpersonating()
if (block) return block
```

Routes that get the guard:

**Loans:**
- `/api/loans/assign-borrower`
- `/api/loans/assign-broker`
- `/api/loans/borrower-phone`
- `/api/loans/closing-date`
- `/api/loans/field`
- `/api/loans/notes`
- `/api/loans/stage`
- `/api/loans/status`
- `/api/loans/conditions/response`
- `/api/loans/upload`
- `/api/loans/upload/record`
- `/api/admin/loans/delete`

**Conditions:**
- `/api/admin/conditions`
- `/api/loan-officer/conditions`
- `/api/loan-processor/conditions`
- `/api/underwriter/conditions`
- `/api/conditions/category`

**Documents / Templates:**
- `/api/documents`
- `/api/admin/templates`
- `/api/templates`

**Deliberately NOT guarded:**
- `/api/admin/view-as/exit` — must work mid-impersonation.
- `/api/cron/*` — no user cookies; protected by `CRON_SECRET`.
- `/api/auth/*` — admin must be able to log out.
- `/api/conditions/action` — email-token actions, no session.

### Layer 2 — UI gating

`<ImpersonationProvider>` wraps PortalShell children. Server pages set `value={{ isImpersonating: !!ctx }}` based on the resolved impersonation context. Mutation components consume the context via `useImpersonation()` hook.

**MVP component scope (top ~10 high-traffic mutation surfaces):**

- `StatusChangeButton` / stage dropdowns
- `DocumentUploadButton` / `UploadZone`
- `ConditionStatusDropdown`
- `AddConditionDialog`
- `InlineEditField` (inline editable fields)
- `SendEmailButton` / template-send actions
- `SyncButton` (admin manual Pipedrive sync)
- Loan field-edit forms

Each renders disabled state with a tooltip: "Read-only preview — exit View As to act."

**Out-of-scope for MVP:** every mutation component. The API guard catches all bypasses; if an admin clicks a non-gated button mid-impersonation they get a 403 toast. We broaden UI gating in a follow-up only if it becomes annoying.

## Security considerations

- **Cookie signing.** Cookie payload includes `admin_id`; on every read we verify HMAC and re-check that `admin_id` is still in `admin_users`. A demoted admin's cookie is invalid on the next request.
- **No privilege escalation.** Impersonating a borrower does not give the admin access to ANYTHING they couldn't already see via `createAdminClient` — it just changes the lens.
- **Audit trail.** Every impersonation start writes to `admin_impersonation_events`. No mutation actions occur under the impersonated identity (read-only enforced server-side), so the audit row is sufficient.
- **No mid-session role swap.** If an admin somehow has both a regular role AND admin row, the cookie-set path requires explicit click-through. There's no way to "accidentally" impersonate.
- **Exit cleanup.** Cookie cleared on `/api/admin/view-as/exit`. Also cleared on `/api/auth/logout`. `ended_at` filled in best-effort; null rows are tolerated (admin closed the tab).

## Risks and tradeoffs

- **Adds deps (`cmdk`).** Mitigated by it being tiny and widely used; cost is one-time.
- **Touches ~25 files across role pages.** Mitigated by mechanical pattern: one helper replaces a one-line lookup. Build will catch any miss.
- **UI gating is partial in MVP.** Mitigated by the blanket API guard — correctness is preserved even where the UI isn't gated; the worst case is a clickable button that 403s.
- **Cookie-based state is global per browser tab.** Cannot open "/admin" in one tab and "view as Jane" in another at the same time. Acceptable for the support/QA use cases; documented as a known constraint.

## Out of scope (follow-ups)

- View-As history page under `/admin` showing recent impersonations.
- "View as" entry points on individual contact list rows (`/admin/borrowers`, `/admin/brokers`, future `/admin/staff`).
- Recording impersonation context on every `loan_events` row (deeper audit).
- Auto-expiring impersonation cookie after N minutes of inactivity.

## Verification plan (Phase 6 preview)

- `npm run build` clean.
- `playwright-role-gates` skill — drives all 5 role sign-ins to confirm no regression in role access patterns.
- Manual: admin picks each of the 5 roles, lands on the right home page, sees their data, banner shows, every mutation button is either disabled OR returns a 403 toast when clicked.
- Manual: Exit returns to `/admin`, cookie cleared, audit row has `ended_at`.
- Preview deploy on Vercel before merge.
