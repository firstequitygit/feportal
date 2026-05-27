# Admin-editable Applications Processing Inbox — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `APPLICATIONS_PROCESSING_INBOX` env var with a DB-backed value editable by admins from a new portal settings page, with env-var fallback so the transition is zero-downtime.

**Architecture:** Generic key/value `app_settings` table (one row per setting) + small server helper (`getAppSetting` / `setAppSetting`) + admin-gated UI page + admin-gated API route. `apply-notify.ts` gains one DB read with env-var fallback. Each setting gets its own purpose-built page; the generic table is ready for future settings but there is no generic admin UI.

**Tech Stack:** Next.js 16 (App Router, React Server Components), Supabase (Postgres + RLS), shadcn/ui, Tailwind v4.

**Reference spec:** `docs/superpowers/specs/2026-05-26-admin-app-settings-design.md`.

---

## Before you start

This is a multi-file feature shipping as one PR. The user is newer to git/PR workflow — keep the branch clean: one feature, off main, deleted after merge.

```powershell
git checkout main
git pull
git checkout -b feat/admin-app-settings
```

The repo has no automated test suite. Build success (`npm run build`) is the correctness gate for type errors and structural breakage. Behavioral verification happens in Phase 6 (Playwright + role-gate sweep). Each task below ends with `npm run build` + commit.

**Repo:** `c:\Users\apalm\FE-Portal\feportal\`. Use the existing PowerShell sandbox; the Bash tool cannot write to the real filesystem on Windows.

**Dependency graph for parallel execution:**
- Tasks 1, 2, 4, 6 are independent — safe to run in parallel worktrees.
- Tasks 3, 5, 7 depend on Task 2 — schedule after Task 2 lands.

---

## File map

| Status | Path | Responsibility |
|---|---|---|
| NEW | `supabase/migrations/20260526-app-settings.sql` | Schema + RLS for `app_settings` |
| NEW | `src/lib/app-settings.ts` | `getAppSetting` + `setAppSetting` server helpers |
| NEW | `src/app/api/admin/settings/route.ts` | GET + PUT, admin gate, validation |
| NEW | `src/app/admin/settings/notifications/notifications-form.tsx` | Client form (single email input + Save) |
| NEW | `src/app/admin/settings/notifications/page.tsx` | Server page, fetches current value + last-edit metadata |
| MOD | `src/components/settings-sidebar.tsx` | Add "Notifications" section + nav entry |
| MOD | `src/lib/apply-notify.ts` (~line 86) | Replace env read with DB-first lookup |

---

## Task 1: Create the `app_settings` table

**Files:**
- Create: `supabase/migrations/20260526-app-settings.sql`
- Apply via: `mcp__claude_ai_Supabase__apply_migration` (or `supabase db push` locally)

- [ ] **Step 1: Write the migration file**

```sql
-- app_settings: key/value store for admin-editable runtime configuration.
-- v1 holds a single key (applications_processing_inbox); table is generic to allow future settings.

create table app_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table app_settings enable row level security;

create policy "admin_users select" on app_settings for select
  using (exists (select 1 from admin_users where auth_user_id = auth.uid()));

create policy "admin_users insert" on app_settings for insert
  with check (exists (select 1 from admin_users where auth_user_id = auth.uid()));

create policy "admin_users update" on app_settings for update
  using (exists (select 1 from admin_users where auth_user_id = auth.uid()));

comment on table app_settings is 'Admin-editable runtime configuration. One row per setting key.';
comment on column app_settings.value is 'Empty string is a valid value (means "unset by admin choice"). Distinguish from missing row, which means "never configured".';
```

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP:

```
mcp__claude_ai_Supabase__apply_migration
  name: 20260526-app-settings
  query: <contents of the migration file>
```

Or via the Supabase CLI if you have a local stack: `supabase db push`.

- [ ] **Step 3: Verify the table exists**

Run via `mcp__claude_ai_Supabase__execute_sql`:

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name = 'app_settings'
order by ordinal_position;
```

Expected: 4 rows (`key text not null`, `value text not null '' default`, `updated_at timestamptz not null now() default`, `updated_by uuid nullable`).

And confirm RLS:

```sql
select polname, cmd from pg_policies where tablename = 'app_settings';
```

Expected: 3 policies (`admin_users select`, `admin_users insert`, `admin_users update`).

- [ ] **Step 4: Commit**

```powershell
git add supabase/migrations/20260526-app-settings.sql
git commit -m "feat(db): add app_settings table for admin-editable runtime config"
```

---

## Task 2: Server helper `src/lib/app-settings.ts`

**Files:**
- Create: `src/lib/app-settings.ts`

- [ ] **Step 1: Write the helper**

```ts
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Reads an admin-editable runtime setting from the app_settings table.
 *
 * Returns null only when the row is missing (never-configured).
 * Returns "" when the admin has explicitly cleared the value.
 * Callers MUST distinguish null (fall back to env) from "" (admin chose "none").
 */
export async function getAppSetting(key: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle()

  if (error) {
    console.error(`getAppSetting(${key}) failed:`, error)
    return null
  }
  return data?.value ?? null
}

/**
 * Upserts an admin-editable runtime setting and stamps updated_by + updated_at.
 * Caller is responsible for admin authorization; this helper does not check.
 */
export async function setAppSetting(
  key: string,
  value: string,
  updatedBy: string,
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('app_settings')
    .upsert(
      { key, value, updated_by: updatedBy, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    )
  if (error) {
    throw new Error(`setAppSetting(${key}) failed: ${error.message}`)
  }
}
```

- [ ] **Step 2: Run the build**

```powershell
npm run build
```

Expected: build succeeds with no new TypeScript errors. (The helper is not yet imported anywhere, so this just confirms the file itself is well-typed.)

- [ ] **Step 3: Commit**

```powershell
git add src/lib/app-settings.ts
git commit -m "feat(lib): add app-settings helper for admin-editable runtime config"
```

---

## Task 3: Admin API route — GET + PUT

**Depends on:** Task 2.

**Files:**
- Create: `src/app/api/admin/settings/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAppSetting, setAppSetting } from '@/lib/app-settings'

const ALLOWED_KEYS = ['applications_processing_inbox'] as const
type AllowedKey = (typeof ALLOWED_KEYS)[number]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isAllowedKey(k: string): k is AllowedKey {
  return (ALLOWED_KEYS as readonly string[]).includes(k)
}

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }

  const { data: admin } = await supabase
    .from('admin_users')
    .select('id, full_name')
    .eq('auth_user_id', user.id)
    .single()
  if (!admin) return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) }

  return { user, admin }
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const key = req.nextUrl.searchParams.get('key')
  if (!key || !isAllowedKey(key)) {
    return NextResponse.json({ error: 'invalid key' }, { status: 400 })
  }

  const value = await getAppSetting(key)

  const supabase = createAdminClient()
  const { data: row } = await supabase
    .from('app_settings')
    .select('updated_at, updated_by')
    .eq('key', key)
    .maybeSingle()

  let updatedByName: string | null = null
  if (row?.updated_by) {
    const { data: editor } = await supabase
      .from('admin_users')
      .select('full_name')
      .eq('auth_user_id', row.updated_by)
      .maybeSingle()
    updatedByName = editor?.full_name ?? null
  }

  return NextResponse.json({
    value: value ?? '',
    updated_at: row?.updated_at ?? null,
    updated_by_name: updatedByName,
  })
}

export async function PUT(req: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  let body: { key?: string; value?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  const { key, value } = body
  if (!key || !isAllowedKey(key)) {
    return NextResponse.json({ error: 'invalid key' }, { status: 400 })
  }
  if (typeof value !== 'string') {
    return NextResponse.json({ error: 'value must be a string' }, { status: 400 })
  }

  const trimmed = value.trim()
  if (trimmed.length > 0) {
    if (!EMAIL_RE.test(trimmed) || trimmed.includes(',')) {
      return NextResponse.json(
        { error: 'value must be empty or a single well-formed email address' },
        { status: 400 },
      )
    }
  }

  await setAppSetting(key, trimmed, gate.user.id)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Run the build**

```powershell
npm run build
```

Expected: build succeeds. Next picks up the new route at `/api/admin/settings`.

- [ ] **Step 3: Commit**

```powershell
git add src/app/api/admin/settings/route.ts
git commit -m "feat(api): add admin settings GET/PUT route with email validation"
```

---

## Task 4: Client form component

**Files:**
- Create: `src/app/admin/settings/notifications/notifications-form.tsx`

- [ ] **Step 1: Write the form component**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

interface Props {
  initialValue: string
  initialUpdatedAt: string | null
  initialUpdatedByName: string | null
}

const KEY = 'applications_processing_inbox'

export function NotificationsForm({ initialValue, initialUpdatedAt, initialUpdatedByName }: Props) {
  const [value, setValue] = useState(initialValue)
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt)
  const [updatedByName, setUpdatedByName] = useState(initialUpdatedByName)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('idle')
    setErrorMsg(null)

    startTransition(async () => {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: KEY, value }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'request failed' }))
        setStatus('error')
        setErrorMsg(body.error ?? 'request failed')
        return
      }

      const refreshed = await fetch(`/api/admin/settings?key=${KEY}`, { cache: 'no-store' })
      if (refreshed.ok) {
        const data = await refreshed.json()
        setValue(data.value)
        setUpdatedAt(data.updated_at)
        setUpdatedByName(data.updated_by_name)
      }
      setStatus('saved')
    })
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-4">
      <div>
        <Label htmlFor="processing-inbox">Processing inbox email</Label>
        <Input
          id="processing-inbox"
          type="email"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="processing@fefunding.com"
          className="mt-1.5"
          autoComplete="off"
        />
        <p className="mt-1.5 text-sm text-gray-600">
          Leave blank to send internal notices only to the assigned loan officer.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving...' : 'Save'}
        </Button>
        {status === 'saved' && <span className="text-sm text-green-700">Saved.</span>}
        {status === 'error' && <span className="text-sm text-red-700">{errorMsg}</span>}
      </div>

      {updatedAt && (
        <p className="text-xs text-gray-500">
          Last updated {new Date(updatedAt).toLocaleString()}
          {updatedByName ? ` by ${updatedByName}` : ''}.
        </p>
      )}
    </form>
  )
}
```

- [ ] **Step 2: Run the build**

```powershell
npm run build
```

Expected: build succeeds. Until Task 5 lands, the component is not rendered anywhere.

- [ ] **Step 3: Commit**

```powershell
git add src/app/admin/settings/notifications/notifications-form.tsx
git commit -m "feat(ui): add notifications-form client component"
```

---

## Task 5: Admin notifications page (server)

**Depends on:** Tasks 2 and 4.

**Files:**
- Create: `src/app/admin/settings/notifications/page.tsx`

- [ ] **Step 1: Write the server page**

```tsx
import { createAdminClient } from '@/lib/supabase/admin'
import { getAppSetting } from '@/lib/app-settings'
import { Card } from '@/components/ui/card'
import { NotificationsForm } from './notifications-form'

const KEY = 'applications_processing_inbox'

export default async function NotificationsSettingsPage() {
  // Admin gate is enforced by the parent layout (src/app/admin/settings/layout.tsx).
  // No additional gate needed here.

  const value = await getAppSetting(KEY)

  const supabase = createAdminClient()
  const { data: row } = await supabase
    .from('app_settings')
    .select('updated_at, updated_by')
    .eq('key', KEY)
    .maybeSingle()

  let updatedByName: string | null = null
  if (row?.updated_by) {
    const { data: editor } = await supabase
      .from('admin_users')
      .select('full_name')
      .eq('auth_user_id', row.updated_by)
      .maybeSingle()
    updatedByName = editor?.full_name ?? null
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Application Inbox</h3>
        <p className="mt-1 text-sm text-gray-600">
          When a borrower submits a loan application, an internal notice is sent to the assigned
          loan officer and to this central inbox.
        </p>
      </div>

      <Card className="p-6">
        <NotificationsForm
          initialValue={value ?? ''}
          initialUpdatedAt={row?.updated_at ?? null}
          initialUpdatedByName={updatedByName}
        />
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Run the build**

```powershell
npm run build
```

Expected: build succeeds. Page is now reachable at `/admin/settings/notifications` once logged in as an admin.

- [ ] **Step 3: Commit**

```powershell
git add src/app/admin/settings/notifications/page.tsx
git commit -m "feat(admin): add notifications settings page"
```

---

## Task 6: Add "Notifications" section to settings sidebar

**Files:**
- Modify: `src/components/settings-sidebar.tsx`

- [ ] **Step 1: Update the sidebar**

Replace the entire file body with:

```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Users, UserCog, ShieldCheck, UserCheck, Mail } from 'lucide-react'

interface Props {
  isSuperAdmin: boolean
}

interface SubItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

interface Section {
  title: string
  items: SubItem[]
}

const USERS_SUBITEMS: SubItem[] = [
  { href: '/admin/settings/users/loan-officers',    label: 'Loan Officers',    icon: Users },
  { href: '/admin/settings/users/loan-processors',  label: 'Loan Processors',  icon: UserCog },
  { href: '/admin/settings/users/underwriters',     label: 'Underwriters',     icon: UserCheck },
]

const ADMINS_SUBITEM: SubItem = {
  href: '/admin/settings/users/admins',
  label: 'Admins',
  icon: ShieldCheck,
}

const NOTIFICATIONS_SUBITEMS: SubItem[] = [
  { href: '/admin/settings/notifications', label: 'Application Inbox', icon: Mail },
]

export function SettingsSidebar({ isSuperAdmin }: Props) {
  const pathname = usePathname()
  const usersItems = isSuperAdmin ? [...USERS_SUBITEMS, ADMINS_SUBITEM] : USERS_SUBITEMS

  const sections: Section[] = [
    { title: 'Users', items: usersItems },
    { title: 'Notifications', items: NOTIFICATIONS_SUBITEMS },
  ]

  return (
    <nav className="w-56 shrink-0 border-r border-gray-200 pr-4">
      {sections.map((section, idx) => (
        <div key={section.title} className={idx > 0 ? 'mt-6' : ''}>
          <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            {section.title}
          </div>
          <ul className="space-y-0.5">
            {section.items.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(href + '/')
              return (
                <li key={href}>
                  <Link
                    href={href}
                    className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${
                      active
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
```

- [ ] **Step 2: Run the build**

```powershell
npm run build
```

Expected: build succeeds. The sidebar now shows two sections.

- [ ] **Step 3: Commit**

```powershell
git add src/components/settings-sidebar.tsx
git commit -m "feat(ui): add Notifications section to settings sidebar"
```

---

## Task 7: Wire `apply-notify.ts` to read from DB first

**Depends on:** Task 2.

**Files:**
- Modify: `src/lib/apply-notify.ts` (imports at top, plus the inbox lookup near line 86)

- [ ] **Step 1: Add the import**

In `src/lib/apply-notify.ts`, add a new import line in the existing import block at the top (after the other `@/lib/...` imports):

```ts
import { getAppSetting } from '@/lib/app-settings'
```

- [ ] **Step 2: Replace the env read with a DB-first lookup**

Find this block (around line 86):

```ts
  // 6. Internal email -> processing inbox + assigned LO.
  const processingInbox = process.env.APPLICATIONS_PROCESSING_INBOX || null
```

Replace with:

```ts
  // 6. Internal email -> processing inbox + assigned LO.
  // Inbox value resolution: DB row (admin-editable, "" = admin chose "none") wins over env var.
  // Env var is the fallback for when the DB row has never been created.
  const dbInbox = await getAppSetting('applications_processing_inbox')
  const processingInbox = dbInbox ?? process.env.APPLICATIONS_PROCESSING_INBOX ?? null
```

The next two lines (the `loEmail` resolution and the `.filter(...)` that builds the `to` array) stay untouched. The existing `.filter(e => !!e && e.includes('@'))` correctly drops the empty string when an admin has cleared the inbox.

- [ ] **Step 3: Run the build**

```powershell
npm run build
```

Expected: build succeeds. No new TypeScript errors.

- [ ] **Step 4: Commit**

```powershell
git add src/lib/apply-notify.ts
git commit -m "feat(apply): read processing inbox from DB with env fallback"
```

---

## Post-implementation smoke check (before Phase 4/5/6)

Before handing off to the polish / verification phases, run the dev server and click through these three scenarios manually. This is not Phase-6 verification (that adds Playwright + role gates) — it is a fast confidence check that the build-time changes actually work at runtime.

- [ ] **Smoke 1: Page loads when logged in as admin.** Start dev server in the worktree on port 3100 (`$env:PORT=3100; npm run dev`), sign in as admin, navigate to `http://localhost:3100/admin/settings/notifications`. Expect to see the new sidebar entry highlighted and the form rendered with an empty input plus the "Leave blank..." helper text.

- [ ] **Smoke 2: Save a valid email.** Type `processing@fefunding.com`, click Save. Expect "Saved." to appear and the "Last updated ..." line to populate with the current admin's name. Refresh the page. Value persists.

- [ ] **Smoke 3: Validation rejects garbage.** Type `not an email`, click Save. Expect a red error message ("value must be empty or a single well-formed email address"). Type `a@b.com, c@d.com` (comma), Save. Same error.

- [ ] **Smoke 4: Empty save is allowed.** Clear the input, click Save. Expect "Saved." and the row to persist with an empty value.

If any of these fail, debug before invoking Phase 6.

---

## Out of scope (do not implement)

- Audit history table (`app_settings_audit`) — spec defers this to v2.
- Multi-recipient comma-separated list — spec specifies single email.
- Generic admin UI for arbitrary `app_settings` keys — each setting gets its own page.
- Removing `APPLICATIONS_PROCESSING_INBOX` from Vercel — this is a follow-up cleanup PR after the DB value is confirmed in production. Leaving it in place during initial rollout preserves zero-downtime rollback.

---

## Self-review

**Spec coverage:**
- Schema + RLS — Task 1. ✓
- Server helper `getAppSetting` / `setAppSetting` — Task 2. ✓
- `apply-notify.ts` DB-first read with env fallback + empty-string semantics — Task 7. ✓
- Admin page at `/admin/settings/notifications` with last-edit metadata — Tasks 4 + 5. ✓
- API route `GET ?key=...` and `PUT { key, value }` with admin gate + email regex + no commas — Task 3. ✓
- Sidebar entry under new "Notifications" section — Task 6. ✓
- Rollout safety (no seed row, env fallback intact) — Tasks 1 + 7. ✓
- Risk surface (auth-adjacent, production notification path) — flagged in spec; Phase 6 handles verification.

**Placeholder scan:** No TBDs. Every code step contains the actual code. Validation regex is explicit. `KEY` constant is consistent across Tasks 3, 4, 5 (always `'applications_processing_inbox'`).

**Type consistency:** `getAppSetting(key: string): Promise<string | null>` signature matches its callers in Tasks 3, 5, and 7. `setAppSetting(key, value, updatedBy)` matches the single caller in Task 3. The PUT route's `EMAIL_RE` is the same regex spec'd.

**Ambiguity:** Task 7's edit references "around line 86" — the explore confirmed the current line and surrounding context. If line numbers have shifted by the time Task 7 runs, search for `APPLICATIONS_PROCESSING_INBOX` in the file; there is exactly one match.
