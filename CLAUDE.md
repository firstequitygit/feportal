# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start local dev server (Next.js)
npm run build    # Production build (runs TypeScript + ESLint)
npm run lint     # ESLint only
```

There are no automated tests. Build is the primary correctness check — always verify `npm run build` passes before considering a change complete. Vercel deploys automatically on push to `main`.

## Stack

- **Next.js 16** (App Router) — all pages are Server Components by default; client components are explicitly marked `'use client'`
- **Supabase** — auth + database + storage (bucket: `documents`)
- **Tailwind CSS v4** with shadcn/ui components in `src/components/ui/`
- **Nodemailer** (Gmail SMTP) for transactional email
- **Pipedrive** as the source of truth for loan data, synced via cron

## Architecture

### Auth & Role Model

There is no middleware. Auth is enforced manually at the top of every Server Component page:

```ts
const supabase = await createClient()          // cookie-based, anon key
const { data: { user } } = await supabase.auth.getUser()
if (!user) redirect('/login')

const adminClient = createAdminClient()        // service role key, bypasses RLS
const { data: role } = await adminClient.from('loan_officers')...eq('auth_user_id', user.id).single()
if (!role) redirect('/login')
```

Five role tables exist: `admin_users`, `loan_officers`, `loan_processors`, `underwriters`, `borrowers`. Each row has `auth_user_id` linking to Supabase Auth. API routes follow the same pattern — call `createClient()` to get the session user, then `createAdminClient()` to query role tables and data.

**Never use the anon client to read sensitive data** — use `createAdminClient()` (service role) in API routes and Server Components after verifying identity.

### Supabase Clients

| Client | File | Usage |
|--------|------|-------|
| `createClient()` | `src/lib/supabase/server.ts` | Session/auth checks in Server Components and API routes |
| `createAdminClient()` | `src/lib/supabase/admin.ts` | All data reads/writes (bypasses RLS) |
| `createClient()` | `src/lib/supabase/client.ts` | Browser-side (file uploads to Storage only) |

### Page / Route Structure

Each role has its own directory under `src/app/`:

| Path prefix | Role |
|---|---|
| `/admin` | Administrator |
| `/loan-officer` | Loan Officer |
| `/loan-processor` | Loan Processor |
| `/underwriter` | Underwriter |
| `/dashboard` or `/loans/[id]` | Borrower |

API routes mirror this: `/api/admin/…`, `/api/loan-officer/…`, `/api/loan-processor/…`, `/api/underwriter/…`. Each route verifies the caller's role before acting.

There is a shared `/api/templates` route (POST/PATCH/DELETE) accessible by admin, underwriter, and loan processor. The admin-only equivalent is `/api/admin/templates`.

### PortalShell

`src/components/portal-shell.tsx` is the single layout wrapper for all authenticated pages. It accepts a `variant` prop that controls which sidebar nav is rendered:

```ts
type Variant = 'default' | 'admin' | 'borrower' | 'loan-officer' | 'loan-processor' | 'underwriter'
```

Each variant has a corresponding `*_NAV` array defined in the file. When adding a new sidebar link for a role, add it to that role's nav array. When adding a new role's sidebar, add a new `Variant` and nav array.

### Key Data Types (`src/lib/types.ts`)

- `ConditionStatus`: `'Outstanding' | 'Received' | 'Satisfied' | 'Waived' | 'Rejected'`
- `AssignedTo`: `'borrower' | 'loan_officer' | 'loan_processor' | 'underwriter'`
- `ConditionCategory`: `'initial' | 'underwriting' | 'pre_close' | 'pre_funding'`
- `PipelineStage`: six stages from `'New Loan / Listing'` through `'Closed'`

**Outstanding conditions** for display/counting purposes = status is `Outstanding` or `Rejected` (not Received, Satisfied, or Waived).

### Pipedrive Sync

`src/lib/pipedrive.ts` maps Pipedrive deal fields to the `loans` table. Pipedrive is the source of truth for loan data — the cron at `/api/cron/sync` runs daily at 8am UTC and upserts loans by `pipedrive_deal_id`. Field key mappings are in `src/lib/types.ts` under `PIPEDRIVE_FIELDS`. Manual sync is available to admins via `src/components/sync-button.tsx`.

### Document Uploads

Two-step process for every role:
1. Call role-scoped `/api/{role}/upload` → returns a signed Supabase Storage URL + path
2. Upload directly from the browser to Supabase Storage using the signed URL
3. Call `/api/{role}/upload/record` → saves the `documents` row in the DB

Storage bucket is `documents`. Signed download URLs are generated server-side and passed as `signedUrlMap: Record<string, string>` (doc.id → URL) to condition components.

### Condition Action Tokens

`/api/conditions/action` handles one-click email links (no login required). Tokens are stored in `condition_action_tokens` with an expiry. Used to let borrowers mark conditions received/satisfied directly from email.

### Cron Jobs (`vercel.json`)

| Path | Schedule | Purpose |
|---|---|---|
| `/api/cron/sync` | Daily 8am UTC | Sync loans from Pipedrive |
| `/api/cron/cleanup-documents` | Daily 2am UTC | Remove orphaned storage files |
| `/api/cron/auto-archive` | Daily 3am UTC | Auto-archive closed loans |

All cron routes are protected by `Authorization: Bearer {CRON_SECRET}`.

### Email

`src/lib/email.ts` and inline `nodemailer` calls in condition API routes send via Gmail SMTP (`GMAIL_USER` + `GMAIL_APP_PASSWORD` env vars). Emails are sent when conditions are added (notifying the assigned party) and when status changes.

## Environment Variables

Required in `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
GMAIL_USER
GMAIL_APP_PASSWORD
CRON_SECRET
PIPEDRIVE_API_TOKEN
```

## Important Conventions

- **Server Components fetch data; Client Components handle interactivity.** Pages are async server components that pass pre-fetched data as props to `'use client'` components.
- **`window.location.reload()`** is the standard pattern after mutations in client components (no optimistic UI framework).
- **`loan_events`** table is the audit log — insert a row after every significant mutation with `event_type` and `description`.
- **Archived loans** are tracked via a separate `archived_loans` table (joined via `get_archived_loan_ids` RPC). Filter them out of active counts with `!archivedSet.has(l.id)`.
- **Board view** in `loan-list-sorted.tsx` uses `PIPELINE_STAGES.slice(0, 5)` — excludes `'Closed'`.
- The `AdminTemplatesManager` component accepts an optional `apiPath` prop (default `/api/admin/templates`) so it can be reused by underwriter and loan processor pages pointing to `/api/templates`.
- **layout.tsx is a server component** — do not use event handlers (`onMouseOver`, etc.) on elements there. Use CSS classes in `globals.css` instead.
