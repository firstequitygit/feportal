# Admin-editable Applications Processing Inbox

**Date:** 2026-05-26
**Status:** Design approved, ready for planning
**Author:** apalmiotto

## Problem

The internal "new loan application" notification sent by `src/lib/apply-notify.ts` routes to two recipients:

1. The assigned loan officer's email (resolved via `src/lib/loan-officer-emails.ts`).
2. A central processing inbox, currently read from `process.env.APPLICATIONS_PROCESSING_INBOX` (= `processing@fefunding.com` in Vercel prod).

Changing the inbox requires editing Vercel and triggering a redeploy. Ops needs the ability to change it from inside the portal.

## Goal

Move the processing inbox value into the database, editable by admins via a new admin settings page. `apply-notify.ts` reads from the DB at notification time. The existing env var becomes a fallback so the transition is zero-downtime.

## Naming note (2026-05-26 patch)

This spec originally used the table name `portal_settings`. That name is already taken in production by an unrelated single-row table holding session-timeout + maintenance-banner config (super-admin RLS only). To avoid the conflict and the RLS asymmetry, the new generic key/value table is named **`portal_settings`** everywhere below. Helper file is `src/lib/portal-settings.ts`, helper functions are `getPortalSetting` / `setPortalSetting`. Architecture is otherwise unchanged.

## Non-goals (v1)

- No audit history table. Just a `updated_by` + `updated_at` pair on the row.
- No multi-recipient list. Single email per setting, matching today's behavior.
- No generic key/value admin UI. The page is purpose-built for the inbox setting. The generic *table* is in place so future settings can reuse it, but each one gets its own page.

## Architecture

A small key/value `portal_settings` table, a tiny server-side helper, one admin page, and one API route. `apply-notify.ts` gains one DB read with env fallback.

### 1. Schema

New migration: `supabase/migrations/20260526-portal-settings.sql`.

```sql
create table portal_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table portal_settings enable row level security;

create policy "portal_settings admin select" on portal_settings for select
  using (exists (select 1 from admin_users where auth_user_id = auth.uid()));

create policy "portal_settings admin insert" on portal_settings for insert
  with check (exists (select 1 from admin_users where auth_user_id = auth.uid()));

create policy "portal_settings admin update" on portal_settings for update
  using (exists (select 1 from admin_users where auth_user_id = auth.uid()));
```

- No seed row. On day one the table is empty, `getPortalSetting` returns `null`, and `apply-notify.ts` falls back to the env var. Behavior is identical to today's deploy.
- Service-role bypass on the SDK side lets `apply-notify.ts` read without a logged-in admin user, since it runs in the borrower's `/apply` submit path.
- `updated_by` is nullable + `on delete set null` so deleting an admin user does not break the row.

### 2. Server helper

New file: `src/lib/portal-settings.ts`.

```ts
export async function getPortalSetting(key: string): Promise<string | null>
export async function setPortalSetting(key: string, value: string, updatedBy: string): Promise<void>
```

- `getPortalSetting` uses a service-role Supabase client. Returns `null` only when the row is missing. An empty-string value is a real admin choice ("no central inbox") and is returned as `""`, not coerced to `null`.
- `setPortalSetting` upserts the row and stamps `updated_by` + `updated_at`. Called only from the admin API route.

### 3. `apply-notify.ts` change

At `src/lib/apply-notify.ts:83`, replace:

```ts
const processingInbox = process.env.APPLICATIONS_PROCESSING_INBOX || null
```

with:

```ts
const dbInbox = await getPortalSetting('applications_processing_inbox')
const processingInbox = dbInbox ?? process.env.APPLICATIONS_PROCESSING_INBOX ?? null
```

The existing `.filter(e => !!e && e.includes('@'))` two lines down already handles an empty string correctly, so an admin who clears the inbox sends LO-only emails with no further code change.

Semantics summary:

| DB state | env state | Effective inbox |
|---|---|---|
| Row missing (`null`) | set | env value |
| Row missing (`null`) | unset | none (LO only) |
| Row value = `""` | either | none (LO only) — admin chose this |
| Row value = `"foo@x.com"` | either | `foo@x.com` |

### 4. Admin page

New: `src/app/admin/settings/notifications/page.tsx`.

- Server component, runs the same `admin_users` gate as `src/app/admin/settings/layout.tsx:13-18` (parent layout already gates; this page inherits it). No extra gate needed here, but the API route gates independently since it does not go through the layout.
- Fetches current value via `getPortalSetting('applications_processing_inbox')` plus last-edited metadata (join `updated_by` to `admin_users.full_name`).
- Renders a shadcn `Card` containing:
  - `Label` "Processing inbox email"
  - `Input type="email"` (single field)
  - Helper text: "Leave blank to send internal notices only to the assigned loan officer."
  - `Button` "Save"
  - Below the form: "Last updated YYYY-MM-DD by Full Name" (omit when never updated).
- Form is a small client component (`useState` + `onSubmit` fetch). No `form.tsx` install needed.

### 5. API route

New: `src/app/api/admin/settings/route.ts`. Generic by key from day one.

- `GET ?key=applications_processing_inbox` returns `{ value, updated_at, updated_by_name }`.
- `PUT` body `{ key, value }`:
  1. Admin gate (same `admin_users` lookup pattern as the page layout).
  2. Validation:
     - `key` must be `applications_processing_inbox` (v1 allowlist of one).
     - `value` empty string passes.
     - Non-empty `value` must match `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` and contain no commas or whitespace (single recipient only).
  3. On success: upsert, return updated row.
  4. On validation failure: 400 with error message.

### 6. Sidebar

Modify `src/components/settings-sidebar.tsx`. Add a second section after the existing "Users" group:

```
Notifications
  - Application Inbox  -> /admin/settings/notifications
```

## Rollout

Two-step, zero-downtime:

1. Ship this PR. Code reads DB (returns `null` because table is empty), falls back to env var, behavior unchanged.
2. Admin opens the new page, types `processing@fefunding.com`, saves. DB now wins. The Vercel env var becomes dead weight and can be removed in a later cleanup PR (do not remove it in this PR — keeps rollback safe).

## Files

| Status | Path |
|---|---|
| NEW | `supabase/migrations/20260526-portal-settings.sql` |
| NEW | `src/lib/portal-settings.ts` |
| NEW | `src/app/admin/settings/notifications/page.tsx` (server) |
| NEW | `src/app/admin/settings/notifications/notifications-form.tsx` (client form) |
| NEW | `src/app/api/admin/settings/route.ts` |
| MOD | `src/lib/apply-notify.ts` (~line 83) |
| MOD | `src/components/settings-sidebar.tsx` |

## Risk surface

- **Auth-adjacent change.** New admin page + new admin-only API route. `playwright-role-gates` must pass in Phase 6 (each of the five roles attempts to load the page and hit the API; only admin succeeds).
- **Production notification path.** `apply-notify.ts` is called on every /apply submission. A bug here silently breaks ops notifications. Fallback chain (`DB -> env -> null`) must be exercised manually (set DB value, clear DB value, leave row missing) before declaring done.
- **RLS.** Borrowers and the other four roles must not be able to SELECT `portal_settings`. Verified by RLS policies above; spot-check with a non-admin session in Phase 6.

## Open implementation questions

None blocking. Tactical decisions (exact regex, page copy, where exactly the form lives in the layout) are bite-sized and resolve during execution.
