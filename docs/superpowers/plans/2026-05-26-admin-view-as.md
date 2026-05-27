# Admin "View As" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global admin "View As" feature: a header button (+ Cmd/Ctrl+K) that opens a command-palette modal to pick any LO/LP/UW/broker/borrower and view the portal exactly as they see it, in read-only mode, with a yellow banner and one-click exit.

**Architecture:** Signed HTTP-only cookie `fe_view_as` carries impersonation state across requests. New `admin_impersonation_events` table audits each start. Existing `src/lib/impersonate.ts` is extended to read the cookie first (falling back to the existing per-loan `?as_*` query params for legacy compat). Mutations are blocked at two layers: an `assertNotImpersonating()` API guard on ~20 mutation routes, and a React `useImpersonation()` hook that disables ~10 high-traffic mutation components.

**Tech Stack:** Next.js 16 App Router, Supabase (auth + Postgres), Tailwind v4, shadcn/ui, cmdk (new dep).

**Spec:** [docs/superpowers/specs/2026-05-26-admin-view-as-design.md](../specs/2026-05-26-admin-view-as-design.md)

**Verification model:** Project has no automated tests. Each task ends with `npm run build` (the correctness gate per CLAUDE.md). Final verification uses the `playwright-role-gates` project skill + a manual run-through + a Vercel preview deploy.

---

## File Structure

**New files:**
- `feportal/supabase/migrations/20260526-admin-impersonation-events.sql` — DB migration
- `feportal/src/lib/view-as-cookie.ts` — sign/verify the `fe_view_as` cookie
- `feportal/src/app/api/admin/view-as/people/route.ts` — preload staff + brokers
- `feportal/src/app/api/admin/view-as/search/route.ts` — borrower on-demand search
- `feportal/src/app/api/admin/view-as/start/route.ts` — write audit row + set cookie
- `feportal/src/app/api/admin/view-as/exit/route.ts` — clear cookie + end audit
- `feportal/src/components/admin-view-as-trigger.tsx` — header button + Cmd/Ctrl+K listener
- `feportal/src/components/admin-view-as-modal.tsx` — cmdk-powered modal
- `feportal/src/components/impersonation-provider.tsx` — React context for UI gating
- `feportal/src/components/ui/command.tsx` — shadcn primitive (installed via CLI)
- `feportal/src/components/ui/dialog.tsx` — shadcn primitive (installed via CLI)

**Modified files:**
- `feportal/src/lib/impersonate.ts` — cookie-first resolution + `assertNotImpersonating()` + `getEffectiveRoleRow()` helpers
- `feportal/src/components/portal-shell.tsx` — header slot for the trigger; wrap children in `ImpersonationProvider`; render `ImpersonationBanner` centrally
- ~25 role tree pages (`/loan-officer/*`, `/loan-processor/*`, `/underwriter/*`, `/dashboard`, `/broker`) — switch role-row lookups to `getEffectiveRoleRow()` or cookie-aware variants
- ~20 mutation API routes — add `assertNotImpersonating()` guard
- ~10 high-traffic mutation components — read `useImpersonation()` and render disabled
- `feportal/package.json` — adds `cmdk` dep

---

## Task 1: Database migration for `admin_impersonation_events`

**Files:**
- Create: `feportal/supabase/migrations/20260526-admin-impersonation-events.sql`

- [ ] **Step 1: Write migration SQL**

Create `feportal/supabase/migrations/20260526-admin-impersonation-events.sql`:

```sql
create table public.admin_impersonation_events (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid not null references public.admin_users(id),
  target_kind  text not null check (target_kind in
                ('borrower','broker','loan_officer','loan_processor','underwriter')),
  target_id    uuid not null,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  user_agent   text
);

create index admin_impersonation_events_admin_started_idx
  on public.admin_impersonation_events (admin_id, started_at desc);

-- This table is written only by service-role API routes. No RLS policies needed;
-- enabling RLS with no policies denies anon/authenticated access by default.
alter table public.admin_impersonation_events enable row level security;
```

- [ ] **Step 2: Apply to remote Supabase**

Use the Supabase MCP `mcp__plugin_supabase__apply_migration` tool with:
- `name`: `20260526-admin-impersonation-events`
- `query`: the SQL above

(Alternatively, paste the SQL into the Supabase SQL editor for the FE-Portal project.)

- [ ] **Step 3: Verify the table exists**

Use `mcp__plugin_supabase__list_tables` (or the Supabase dashboard) and confirm `admin_impersonation_events` is present with the expected columns.

- [ ] **Step 4: Commit**

```bash
cd feportal
git add supabase/migrations/20260526-admin-impersonation-events.sql
git commit -m "feat(view-as): add admin_impersonation_events audit table"
```

---

## Task 2: Signed cookie utility

**Files:**
- Create: `feportal/src/lib/view-as-cookie.ts`

- [ ] **Step 1: Write the cookie utility**

Create `feportal/src/lib/view-as-cookie.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

export type ViewAsKind =
  | 'borrower' | 'broker'
  | 'loan_officer' | 'loan_processor' | 'underwriter'

export interface ViewAsCookiePayload {
  kind: ViewAsKind
  target_id: string
  admin_id: string
  started_at: string
}

export const VIEW_AS_COOKIE = 'fe_view_as'

function secret(): string {
  const s = process.env.VIEW_AS_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!s) throw new Error('VIEW_AS_SECRET (or SUPABASE_SERVICE_ROLE_KEY fallback) missing')
  return s
}

export function signViewAsCookie(payload: ViewAsCookiePayload): string {
  const json = JSON.stringify(payload)
  const b64 = Buffer.from(json, 'utf8').toString('base64url')
  const sig = createHmac('sha256', secret()).update(b64).digest('base64url')
  return `${b64}.${sig}`
}

export function verifyViewAsCookie(value: string | undefined): ViewAsCookiePayload | null {
  if (!value) return null
  const [b64, sig] = value.split('.')
  if (!b64 || !sig) return null
  const expected = createHmac('sha256', secret()).update(b64).digest('base64url')
  const a = Buffer.from(sig, 'base64url')
  const b = Buffer.from(expected, 'base64url')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const obj = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'))
    if (
      obj && typeof obj === 'object' &&
      typeof obj.kind === 'string' && typeof obj.target_id === 'string' &&
      typeof obj.admin_id === 'string' && typeof obj.started_at === 'string'
    ) {
      return obj as ViewAsCookiePayload
    }
    return null
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Build passes**

Run: `cd feportal && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
cd feportal
git add src/lib/view-as-cookie.ts
git commit -m "feat(view-as): add signed cookie utility"
```

---

## Task 3: Extend `src/lib/impersonate.ts` with cookie support + guards

**Files:**
- Modify: `feportal/src/lib/impersonate.ts`

- [ ] **Step 1: Add cookie-first resolution and helpers**

Append to `feportal/src/lib/impersonate.ts` (and modify `resolveImpersonation` per Step 2):

```ts
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { verifyViewAsCookie, VIEW_AS_COOKIE } from '@/lib/view-as-cookie'

/**
 * Read the signed view-as cookie, verify the admin still exists, and return
 * an ImpersonationContext. Returns null if cookie missing, invalid, or admin
 * no longer exists.
 */
export async function readImpersonationCookie(supa: Admin): Promise<ImpersonationContext | null> {
  const c = await cookies()
  const payload = verifyViewAsCookie(c.get(VIEW_AS_COOKIE)?.value)
  if (!payload) return null
  const { data: admin } = await supa
    .from('admin_users').select('id').eq('id', payload.admin_id).maybeSingle()
  if (!admin) return null
  return {
    kind: payload.kind,
    id: payload.target_id,
    impersonatorRole: 'admin',
  }
}

/**
 * For mutation API routes. Returns a 403 NextResponse if the request is
 * coming from an active View-As session; otherwise returns null and the
 * route proceeds normally.
 */
export async function assertNotImpersonating(): Promise<NextResponse | null> {
  const c = await cookies()
  if (c.get(VIEW_AS_COOKIE)) {
    return NextResponse.json(
      { error: 'Read-only preview: exit View As to make changes.' },
      { status: 403 }
    )
  }
  return null
}

const ROLE_TABLE = {
  loan_officer:   'loan_officers',
  loan_processor: 'loan_processors',
  underwriter:    'underwriters',
} as const

/**
 * For LO/LP/UW role home pages. If the view-as cookie targets this role,
 * returns that target's row. Otherwise returns the auth user's own role row.
 */
export async function getEffectiveRoleRow<T extends Record<string, unknown> = Record<string, unknown>>(
  supa: Admin,
  kind: 'loan_officer' | 'loan_processor' | 'underwriter',
  authUserId: string,
): Promise<T | null> {
  const ctx = await readImpersonationCookie(supa)
  if (ctx?.kind === kind) {
    const { data } = await supa.from(ROLE_TABLE[kind]).select('*').eq('id', ctx.id).maybeSingle()
    return (data ?? null) as T | null
  }
  const { data } = await supa.from(ROLE_TABLE[kind]).select('*').eq('auth_user_id', authUserId).maybeSingle()
  return (data ?? null) as T | null
}
```

- [ ] **Step 2: Modify `resolveImpersonation` to check cookie first**

At the top of the existing `resolveImpersonation` function body, before any other logic, add:

```ts
  // New: cookie-based admin global picker takes precedence.
  const cookieCtx = await readImpersonationCookie(supa)
  if (cookieCtx) return cookieCtx
```

So the function reads:

```ts
export async function resolveImpersonation(
  supa: Admin,
  authUserId: string,
  searchParams: { [k: string]: string | string[] | undefined } | undefined,
  options: { loanIdForAccessCheck?: string } = {},
): Promise<ImpersonationContext | null> {
  const cookieCtx = await readImpersonationCookie(supa)
  if (cookieCtx) return cookieCtx

  if (!searchParams) return null
  // ... existing query-param logic UNCHANGED below
```

- [ ] **Step 3: Build passes**

Run: `cd feportal && npm run build`
Expected: build succeeds (no callers broken; new signature is backward compatible because new functions are pure additions and `resolveImpersonation` still accepts the same args).

- [ ] **Step 4: Commit**

```bash
cd feportal
git add src/lib/impersonate.ts
git commit -m "feat(view-as): cookie-first impersonation resolution + API guard"
```

---

## Task 4: API route — `/api/admin/view-as/start`

**Files:**
- Create: `feportal/src/app/api/admin/view-as/start/route.ts`

- [ ] **Step 1: Write the start route**

Create `feportal/src/app/api/admin/view-as/start/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { signViewAsCookie, VIEW_AS_COOKIE, type ViewAsKind } from '@/lib/view-as-cookie'

const REDIRECT_BY_KIND: Record<ViewAsKind, string> = {
  borrower:       '/dashboard',
  broker:         '/broker',
  loan_officer:   '/loan-officer/inbox',
  loan_processor: '/loan-processor/inbox',
  underwriter:    '/underwriter/inbox',
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminRow } = await admin
    .from('admin_users').select('id').eq('auth_user_id', user.id).maybeSingle()
  if (!adminRow) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null) as { kind?: ViewAsKind; id?: string } | null
  const kind = body?.kind
  const id   = body?.id
  if (!kind || !id || !(kind in REDIRECT_BY_KIND)) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }

  const startedAt = new Date().toISOString()

  await admin.from('admin_impersonation_events').insert({
    admin_id: adminRow.id,
    target_kind: kind,
    target_id: id,
    started_at: startedAt,
    user_agent: req.headers.get('user-agent'),
  })

  const cookie = signViewAsCookie({
    kind, target_id: id, admin_id: adminRow.id, started_at: startedAt,
  })

  const c = await cookies()
  c.set(VIEW_AS_COOKIE, cookie, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  })

  return NextResponse.json({ redirectTo: REDIRECT_BY_KIND[kind] })
}
```

- [ ] **Step 2: Build passes**

Run: `cd feportal && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
cd feportal
git add src/app/api/admin/view-as/start/route.ts
git commit -m "feat(view-as): POST /api/admin/view-as/start"
```

---

## Task 5: API route — `/api/admin/view-as/exit`

**Files:**
- Create: `feportal/src/app/api/admin/view-as/exit/route.ts`

- [ ] **Step 1: Write the exit route**

Create `feportal/src/app/api/admin/view-as/exit/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyViewAsCookie, VIEW_AS_COOKIE } from '@/lib/view-as-cookie'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const c = await cookies()
  const payload = verifyViewAsCookie(c.get(VIEW_AS_COOKIE)?.value)

  if (payload) {
    const admin = createAdminClient()
    // Best-effort: close the most recent open audit row for this admin.
    const { data: openRow } = await admin
      .from('admin_impersonation_events')
      .select('id')
      .eq('admin_id', payload.admin_id)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (openRow) {
      await admin
        .from('admin_impersonation_events')
        .update({ ended_at: new Date().toISOString() })
        .eq('id', openRow.id)
    }
  }

  c.set(VIEW_AS_COOKIE, '', { path: '/', maxAge: 0 })
  return NextResponse.json({ redirectTo: '/admin' })
}
```

- [ ] **Step 2: Build passes**

Run: `cd feportal && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
cd feportal
git add src/app/api/admin/view-as/exit/route.ts
git commit -m "feat(view-as): POST /api/admin/view-as/exit"
```

---

## Task 6: API route — `/api/admin/view-as/people` (preloaded staff + brokers)

**Files:**
- Create: `feportal/src/app/api/admin/view-as/people/route.ts`

- [ ] **Step 1: Write the people route**

Create `feportal/src/app/api/admin/view-as/people/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminRow } = await admin
    .from('admin_users').select('id').eq('auth_user_id', user.id).maybeSingle()
  if (!adminRow) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const [los, lps, uws, brokers] = await Promise.all([
    admin.from('loan_officers').select('id, full_name, email').order('full_name'),
    admin.from('loan_processors').select('id, full_name, email').order('full_name'),
    admin.from('underwriters').select('id, full_name, email').order('full_name'),
    admin.from('brokers').select('id, full_name, email, company_name').order('full_name'),
  ])

  return NextResponse.json({
    loan_officers:   los.data ?? [],
    loan_processors: lps.data ?? [],
    underwriters:    uws.data ?? [],
    brokers:         brokers.data ?? [],
  })
}
```

- [ ] **Step 2: Build passes + commit**

```bash
cd feportal && npm run build
git add src/app/api/admin/view-as/people/route.ts
git commit -m "feat(view-as): GET /api/admin/view-as/people"
```

---

## Task 7: API route — `/api/admin/view-as/search` (borrower on-demand)

**Files:**
- Create: `feportal/src/app/api/admin/view-as/search/route.ts`

- [ ] **Step 1: Write the search route**

Create `feportal/src/app/api/admin/view-as/search/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminRow } = await admin
    .from('admin_users').select('id').eq('auth_user_id', user.id).maybeSingle()
  if (!adminRow) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  const kind = url.searchParams.get('kind') ?? 'borrower'
  if (kind !== 'borrower' || q.length < 1) {
    return NextResponse.json({ results: [] })
  }

  const pattern = `%${q.replace(/[%_]/g, '\\$&')}%`
  const { data } = await admin
    .from('borrowers')
    .select('id, full_name, email')
    .or(`full_name.ilike.${pattern},email.ilike.${pattern}`)
    .order('full_name')
    .limit(20)

  return NextResponse.json({ results: data ?? [] })
}
```

- [ ] **Step 2: Build passes + commit**

```bash
cd feportal && npm run build
git add src/app/api/admin/view-as/search/route.ts
git commit -m "feat(view-as): GET /api/admin/view-as/search (borrowers)"
```

---

## Task 8: Install shadcn `command` + `dialog` primitives

**Files:**
- Add deps via CLI: `cmdk`, plus shadcn-generated `feportal/src/components/ui/command.tsx` and `feportal/src/components/ui/dialog.tsx`.

- [ ] **Step 1: Install cmdk**

```bash
cd feportal
npm i cmdk
```

- [ ] **Step 2: Generate shadcn primitives**

```bash
cd feportal
npx shadcn@latest add command dialog
```

When prompted, confirm overwriting nothing existing (these files don't exist yet).

- [ ] **Step 3: Build passes**

Run: `cd feportal && npm run build`
Expected: build succeeds. shadcn-generated files should be valid TS.

- [ ] **Step 4: Commit**

```bash
cd feportal
git add package.json package-lock.json src/components/ui/command.tsx src/components/ui/dialog.tsx
git commit -m "feat(view-as): install cmdk + shadcn command/dialog primitives"
```

---

## Task 9: React context — `ImpersonationProvider`

**Files:**
- Create: `feportal/src/components/impersonation-provider.tsx`

- [ ] **Step 1: Write the provider**

Create `feportal/src/components/impersonation-provider.tsx`:

```tsx
'use client'

import { createContext, useContext, type ReactNode } from 'react'

interface ImpersonationState {
  isImpersonating: boolean
}

const ImpersonationContext = createContext<ImpersonationState>({ isImpersonating: false })

export function ImpersonationProvider({
  value, children,
}: { value: ImpersonationState; children: ReactNode }) {
  return <ImpersonationContext.Provider value={value}>{children}</ImpersonationContext.Provider>
}

export function useImpersonation(): ImpersonationState {
  return useContext(ImpersonationContext)
}
```

- [ ] **Step 2: Build passes + commit**

```bash
cd feportal && npm run build
git add src/components/impersonation-provider.tsx
git commit -m "feat(view-as): ImpersonationProvider + useImpersonation hook"
```

---

## Task 10: View-As modal component

**Files:**
- Create: `feportal/src/components/admin-view-as-modal.tsx`

- [ ] **Step 1: Write the modal**

Create `feportal/src/components/admin-view-as-modal.tsx`:

```tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem,
} from '@/components/ui/command'
import type { ViewAsKind } from '@/lib/view-as-cookie'

interface Person { id: string; full_name: string | null; email: string | null; company_name?: string | null }
interface PeopleData {
  loan_officers: Person[]; loan_processors: Person[]
  underwriters: Person[]; brokers: Person[]
}

interface Props { open: boolean; onOpenChange: (open: boolean) => void }

export function AdminViewAsModal({ open, onOpenChange }: Props) {
  const router = useRouter()
  const [people, setPeople] = useState<PeopleData | null>(null)
  const [query, setQuery] = useState('')
  const [borrowers, setBorrowers] = useState<Person[]>([])
  const [submitting, setSubmitting] = useState(false)

  // Lazy-load staff + brokers on first open.
  useEffect(() => {
    if (!open || people) return
    fetch('/api/admin/view-as/people')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setPeople(d) })
  }, [open, people])

  // Debounced borrower search.
  useEffect(() => {
    if (!open || query.trim().length < 1) { setBorrowers([]); return }
    const handle = setTimeout(() => {
      fetch(`/api/admin/view-as/search?kind=borrower&q=${encodeURIComponent(query.trim())}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.results) setBorrowers(d.results) })
    }, 200)
    return () => clearTimeout(handle)
  }, [open, query])

  async function pick(kind: ViewAsKind, id: string) {
    if (submitting) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/view-as/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, id }),
      })
      if (!res.ok) { setSubmitting(false); return }
      const { redirectTo } = await res.json() as { redirectTo: string }
      onOpenChange(false)
      router.push(redirectTo)
    } catch {
      setSubmitting(false)
    }
  }

  const groups = useMemo(() => people ? [
    { kind: 'loan_officer'   as const, label: 'Loan Officers',   rows: people.loan_officers },
    { kind: 'loan_processor' as const, label: 'Loan Processors', rows: people.loan_processors },
    { kind: 'underwriter'    as const, label: 'Underwriters',    rows: people.underwriters },
    { kind: 'broker'         as const, label: 'Brokers',         rows: people.brokers },
  ] : [], [people])

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search people to view as..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No people found.</CommandEmpty>
        {groups.map(g => g.rows.length > 0 && (
          <CommandGroup key={g.kind} heading={g.label}>
            {g.rows.map(p => (
              <CommandItem
                key={`${g.kind}-${p.id}`}
                value={`${g.label} ${p.full_name ?? ''} ${p.email ?? ''} ${p.company_name ?? ''}`}
                onSelect={() => pick(g.kind, p.id)}
              >
                <div className="flex flex-col">
                  <span>{p.full_name ?? '(no name)'}</span>
                  <span className="text-xs text-gray-500">
                    {p.email}{p.company_name ? ` · ${p.company_name}` : ''}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        {borrowers.length > 0 && (
          <CommandGroup heading="Borrowers">
            {borrowers.map(p => (
              <CommandItem
                key={`borrower-${p.id}`}
                value={`Borrower ${p.full_name ?? ''} ${p.email ?? ''}`}
                onSelect={() => pick('borrower', p.id)}
              >
                <div className="flex flex-col">
                  <span>{p.full_name ?? '(no name)'}</span>
                  <span className="text-xs text-gray-500">{p.email}</span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
```

- [ ] **Step 2: Build passes + commit**

```bash
cd feportal && npm run build
git add src/components/admin-view-as-modal.tsx
git commit -m "feat(view-as): cmdk-powered modal picker"
```

---

## Task 11: View-As trigger button (header + Cmd/Ctrl+K)

**Files:**
- Create: `feportal/src/components/admin-view-as-trigger.tsx`

- [ ] **Step 1: Write the trigger**

Create `feportal/src/components/admin-view-as-trigger.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Eye } from 'lucide-react'
import { AdminViewAsModal } from '@/components/admin-view-as-modal'

/**
 * Header button that opens the View-As modal. Also listens for the
 * Cmd/Ctrl+K keyboard shortcut. Render this only when the current user
 * is an admin AND not already impersonating.
 */
export function AdminViewAsTrigger() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
        title="View as another user (Cmd/Ctrl+K)"
      >
        <Eye className="w-3.5 h-3.5" />
        View as
        <kbd className="ml-1 hidden sm:inline text-xs text-gray-400">⌘K</kbd>
      </button>
      <AdminViewAsModal open={open} onOpenChange={setOpen} />
    </>
  )
}
```

- [ ] **Step 2: Build passes + commit**

```bash
cd feportal && npm run build
git add src/components/admin-view-as-trigger.tsx
git commit -m "feat(view-as): header trigger button + Cmd/Ctrl+K shortcut"
```

---

## Task 12: Wire trigger + provider + banner into PortalShell

**Files:**
- Modify: `feportal/src/components/portal-shell.tsx`

- [ ] **Step 1: Extend the Props interface**

In `feportal/src/components/portal-shell.tsx`, modify the `Props` interface (around line 27-36) to add two new optional props:

```ts
interface Props {
  userName: string | null
  userRole: string
  dashboardHref: string
  variant?: Variant
  maxWidth?: string
  /** Admin only: when true, surface the super-admin-only nav items (Admins). */
  isSuperAdmin?: boolean
  /** When true, render the header "View as" trigger. Pass only for admins
   *  who are NOT currently impersonating. */
  showViewAsTrigger?: boolean
  /** When set, render the impersonation banner above children and wrap
   *  children in ImpersonationProvider with isImpersonating=true. */
  impersonation?: {
    kind: 'borrower' | 'broker' | 'loan_officer' | 'loan_processor' | 'underwriter'
    name: string | null
    exitHref: string
  } | null
  children: React.ReactNode
}
```

- [ ] **Step 2: Add imports at the top of the file**

After the existing imports in `portal-shell.tsx`, add:

```ts
import { AdminViewAsTrigger } from '@/components/admin-view-as-trigger'
import { ImpersonationBanner } from '@/components/impersonation-banner'
import { ImpersonationProvider } from '@/components/impersonation-provider'
```

- [ ] **Step 3: Inject the trigger into the header**

Find the header JSX (lines ~127-147, the element with `className="fixed top-0 left-0 right-0 h-14 ..."`). Before the existing `<div className="ml-auto pr-5">` (the logo block), insert:

```tsx
{showViewAsTrigger && (
  <div className="ml-auto pr-3">
    <AdminViewAsTrigger />
  </div>
)}
```

Then change the logo block's class from `ml-auto pr-5` to just `pr-5` (since the trigger now takes the `ml-auto` slot when present). If the trigger is NOT shown, the logo still needs `ml-auto`. Easiest: keep the logo wrapper as `ml-auto pr-5` and instead place the trigger BEFORE it with `mr-3 ml-auto` and remove `ml-auto` from logo. Concretely, the new layout becomes:

```tsx
<header className="fixed top-0 left-0 right-0 h-14 flex items-center z-10 bg-white border-b border-gray-200">
  <button onClick={() => setOpen(true)} ...>{/* hamburger */}</button>
  {showViewAsTrigger ? (
    <>
      <div className="ml-auto mr-3"><AdminViewAsTrigger /></div>
      <div className="pr-5"><Image ... /></div>
    </>
  ) : (
    <div className="ml-auto pr-5"><Image ... /></div>
  )}
</header>
```

(Match the existing logo `<Image>` element exactly — don't remove its props.)

- [ ] **Step 4: Wrap children in ImpersonationProvider + render banner**

Locate where `{children}` is rendered in the layout (in the main content area). Replace with:

```tsx
<ImpersonationProvider value={{ isImpersonating: !!impersonation }}>
  {impersonation && (
    <ImpersonationBanner
      kind={impersonation.kind}
      name={impersonation.name}
      exitHref={impersonation.exitHref}
    />
  )}
  {children}
</ImpersonationProvider>
```

- [ ] **Step 5: Build passes**

Run: `cd feportal && npm run build`
Expected: build succeeds. Existing callers that don't pass the new props get default `false`/`null` behavior (no trigger, no banner) — no regression.

- [ ] **Step 6: Commit**

```bash
cd feportal
git add src/components/portal-shell.tsx
git commit -m "feat(view-as): wire trigger + provider + banner into PortalShell"
```

---

## Task 13: Update `/dashboard` and `/broker` pages to use the new PortalShell wiring

**Files:**
- Modify: `feportal/src/app/dashboard/page.tsx`
- Modify: `feportal/src/app/broker/page.tsx`

- [ ] **Step 1: Update `/dashboard/page.tsx`**

In `feportal/src/app/dashboard/page.tsx`:

1. The existing `resolveImpersonation()` call already returns the cookie context (after Task 3), so no change there.
2. Remove the explicit `<ImpersonationBanner ... />` render inside the JSX (it now renders centrally via PortalShell).
3. Compute showViewAsTrigger: this page is borrower-facing, so always `false`.
4. Pass `impersonation` to PortalShell when `isImpersonating`:

```tsx
import { impersonationExitHref } from '@/lib/impersonate'
// (already imported)

// In the render, replace the existing PortalShell open tag + banner with:
return (
  <PortalShell
    userName={borrower.full_name ?? user.email ?? null}
    userRole="Borrower"
    dashboardHref="/dashboard"
    impersonation={isImpersonating ? {
      kind: 'borrower',
      name: borrower.full_name,
      exitHref: impersonationExitHref(),
    } : null}
  >
    {/* delete the existing <ImpersonationBanner ... /> line */}
    <h2 className="text-2xl font-bold text-gray-900 mb-6">My Loans</h2>
    {/* ... rest unchanged ... */}
  </PortalShell>
)
```

- [ ] **Step 2: Update `/broker/page.tsx`**

Same pattern in `feportal/src/app/broker/page.tsx`:

```tsx
return (
  <PortalShell
    userName={broker.full_name ?? broker.email}
    userRole="Broker"
    dashboardHref="/broker"
    variant="broker"
    impersonation={isImpersonating ? {
      kind: 'broker',
      name: broker.full_name,
      exitHref: impersonationExitHref(),
    } : null}
  >
    {/* delete the existing <ImpersonationBanner ... /> line */}
    <div className="mb-6">
    {/* ... rest unchanged ... */}
  </PortalShell>
)
```

- [ ] **Step 3: Build passes + commit**

```bash
cd feportal && npm run build
git add src/app/dashboard/page.tsx src/app/broker/page.tsx
git commit -m "feat(view-as): centralize banner rendering for borrower/broker pages"
```

---

## Task 14: Loan Officer tree — switch lookups to `getEffectiveRoleRow`

**Files (9):**
- Modify: `feportal/src/app/loan-officer/page.tsx`
- Modify: `feportal/src/app/loan-officer/inbox/page.tsx`
- Modify: `feportal/src/app/loan-officer/loans/page.tsx`
- Modify: `feportal/src/app/loan-officer/loans/[id]/page.tsx`
- Modify: `feportal/src/app/loan-officer/archived/page.tsx`
- Modify: `feportal/src/app/loan-officer/conditions/page.tsx`
- Modify: `feportal/src/app/loan-officer/borrowers/page.tsx`
- Modify: `feportal/src/app/loan-officer/brokers/page.tsx`
- Modify: `feportal/src/app/loan-officer/vendors/page.tsx`

- [ ] **Step 1: Replace the role-row lookup in every file**

In each file, find the existing block (line numbers vary slightly):

```ts
const { data: lo } = await adminClient
  .from('loan_officers')
  .select('*')
  .eq('auth_user_id', user.id)
  .single()
if (!lo) redirect('/login')
```

Replace with:

```ts
import { getEffectiveRoleRow, resolveImpersonation, impersonationExitHref } from '@/lib/impersonate'
// (add to existing imports at top of file)

const lo = await getEffectiveRoleRow<{ id: string; full_name: string | null; email: string | null }>(
  adminClient, 'loan_officer', user.id
)
if (!lo) redirect('/login')
```

(For files that already import from `@/lib/impersonate`, just add the missing named imports.)

- [ ] **Step 2: Plumb impersonation into PortalShell (for pages that render it directly)**

For each LO page that calls `<PortalShell>`, compute the impersonation context once near the top:

```ts
const impersonation = await resolveImpersonation(adminClient, user.id, undefined)
const isImpersonating = impersonation?.kind === 'loan_officer'
```

Then pass to PortalShell:

```tsx
<PortalShell
  userName={lo.full_name ?? user.email ?? null}
  userRole="Loan Officer"
  dashboardHref="/loan-officer/inbox"
  variant="loan-officer"
  impersonation={isImpersonating ? {
    kind: 'loan_officer', name: lo.full_name, exitHref: impersonationExitHref(),
  } : null}
>
```

- [ ] **Step 3: Build passes**

Run: `cd feportal && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
cd feportal
git add src/app/loan-officer/
git commit -m "feat(view-as): LO tree uses getEffectiveRoleRow + impersonation banner"
```

---

## Task 15: Loan Processor tree — switch lookups to `getEffectiveRoleRow`

**Files (10):**
- All `feportal/src/app/loan-processor/**/page.tsx` files (per the file structure survey).

- [ ] **Step 1: Apply the same pattern as Task 14**

In each LP page, replace:

```ts
const { data: lp } = await adminClient
  .from('loan_processors')
  .select('*')
  .eq('auth_user_id', user.id)
  .single()
```

with:

```ts
import { getEffectiveRoleRow, resolveImpersonation, impersonationExitHref } from '@/lib/impersonate'

const lp = await getEffectiveRoleRow<{ id: string; full_name: string | null; email: string | null }>(
  adminClient, 'loan_processor', user.id
)
if (!lp) redirect('/login')
```

Then in each page that renders PortalShell, add:

```ts
const impersonation = await resolveImpersonation(adminClient, user.id, undefined)
const isImpersonating = impersonation?.kind === 'loan_processor'
```

```tsx
<PortalShell
  userName={lp.full_name ?? user.email ?? null}
  userRole="Loan Processor"
  dashboardHref="/loan-processor/inbox"
  variant="loan-processor"
  impersonation={isImpersonating ? {
    kind: 'loan_processor', name: lp.full_name, exitHref: impersonationExitHref(),
  } : null}
>
```

- [ ] **Step 2: Build passes + commit**

```bash
cd feportal && npm run build
git add src/app/loan-processor/
git commit -m "feat(view-as): LP tree uses getEffectiveRoleRow + impersonation banner"
```

---

## Task 16: Underwriter tree — switch lookups to `getEffectiveRoleRow`

**Files (5):**
- All `feportal/src/app/underwriter/**/page.tsx` files.

- [ ] **Step 1: Apply the same pattern as Task 14**

```ts
import { getEffectiveRoleRow, resolveImpersonation, impersonationExitHref } from '@/lib/impersonate'

const uw = await getEffectiveRoleRow<{ id: string; full_name: string | null; email: string | null }>(
  adminClient, 'underwriter', user.id
)
if (!uw) redirect('/login')

const impersonation = await resolveImpersonation(adminClient, user.id, undefined)
const isImpersonating = impersonation?.kind === 'underwriter'
```

```tsx
<PortalShell
  userName={uw.full_name ?? user.email ?? null}
  userRole="Underwriter"
  dashboardHref="/underwriter/inbox"
  variant="underwriter"
  impersonation={isImpersonating ? {
    kind: 'underwriter', name: uw.full_name, exitHref: impersonationExitHref(),
  } : null}
>
```

- [ ] **Step 2: Build passes + commit**

```bash
cd feportal && npm run build
git add src/app/underwriter/
git commit -m "feat(view-as): UW tree uses getEffectiveRoleRow + impersonation banner"
```

---

## Task 17: Admin pages — pass `showViewAsTrigger` to PortalShell

**Files:**
- All `feportal/src/app/admin/**/page.tsx` files (per the survey: home, borrowers, brokers, vendors, templates, archived, settings, reports, loans/[id]).

- [ ] **Step 1: Compute trigger visibility on every admin page that renders PortalShell**

For each admin page, right before the PortalShell render, add (after the existing admin row lookup):

```ts
// Admin can be impersonating via the per-loan dropdown (?as_*) when viewing
// a specific loan; otherwise readImpersonationCookie also covers global.
const impersonation = await resolveImpersonation(adminClient, user.id, undefined)
const showViewAsTrigger = !impersonation
```

Then pass to PortalShell:

```tsx
<PortalShell
  userName={...}
  userRole="Admin"
  dashboardHref="/admin"
  variant="admin"
  isSuperAdmin={isSuperAdmin}
  showViewAsTrigger={showViewAsTrigger}
>
```

(Don't pass `impersonation` here — admin pages don't show the banner; if an admin is impersonating they're routed to the impersonated user's home page where the banner DOES render.)

- [ ] **Step 2: Build passes + commit**

```bash
cd feportal && npm run build
git add src/app/admin/
git commit -m "feat(view-as): admin pages surface View-As trigger in header"
```

---

## Task 18: API guards — Loans mutation routes

**Files (12):**
- Modify: `feportal/src/app/api/loans/assign-borrower/route.ts`
- Modify: `feportal/src/app/api/loans/assign-broker/route.ts`
- Modify: `feportal/src/app/api/loans/borrower-phone/route.ts`
- Modify: `feportal/src/app/api/loans/closing-date/route.ts`
- Modify: `feportal/src/app/api/loans/field/route.ts`
- Modify: `feportal/src/app/api/loans/notes/route.ts`
- Modify: `feportal/src/app/api/loans/stage/route.ts`
- Modify: `feportal/src/app/api/loans/status/route.ts`
- Modify: `feportal/src/app/api/loans/conditions/response/route.ts`
- Modify: `feportal/src/app/api/loans/upload/route.ts`
- Modify: `feportal/src/app/api/loans/upload/record/route.ts`
- Modify: `feportal/src/app/api/admin/loans/delete/route.ts`

- [ ] **Step 1: Add the guard to every mutation handler**

For each file above, find each exported `POST` / `PATCH` / `PUT` / `DELETE` function. At the very top of the function body, add:

```ts
import { assertNotImpersonating } from '@/lib/impersonate'
// (add to existing imports at the top of the file)

export async function POST(req: Request) {
  const block = await assertNotImpersonating()
  if (block) return block
  // ... existing handler body unchanged ...
}
```

If a file exports both POST and PATCH (or any combination), add the two-line guard at the top of EACH.

- [ ] **Step 2: Build passes**

Run: `cd feportal && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
cd feportal
git add src/app/api/loans/ src/app/api/admin/loans/
git commit -m "feat(view-as): API guard on loans mutation routes"
```

---

## Task 19: API guards — Conditions, Documents, Templates

**Files (8):**
- Modify: `feportal/src/app/api/admin/conditions/route.ts`
- Modify: `feportal/src/app/api/loan-officer/conditions/route.ts`
- Modify: `feportal/src/app/api/loan-processor/conditions/route.ts`
- Modify: `feportal/src/app/api/underwriter/conditions/route.ts`
- Modify: `feportal/src/app/api/conditions/category/route.ts`
- Modify: `feportal/src/app/api/documents/route.ts`
- Modify: `feportal/src/app/api/admin/templates/route.ts`
- Modify: `feportal/src/app/api/templates/route.ts`

- [ ] **Step 1: Same pattern as Task 18 — guard every mutation handler**

For each file above, add to every exported `POST` / `PATCH` / `PUT` / `DELETE` function:

```ts
import { assertNotImpersonating } from '@/lib/impersonate'

export async function POST/PATCH/PUT/DELETE(...) {
  const block = await assertNotImpersonating()
  if (block) return block
  // ... existing handler body ...
}
```

GET handlers are NOT guarded (reads are allowed in read-only preview mode).

- [ ] **Step 2: Build passes + commit**

```bash
cd feportal && npm run build
git add src/app/api/conditions/ src/app/api/documents/ src/app/api/templates/ src/app/api/admin/conditions/ src/app/api/admin/templates/ src/app/api/loan-officer/conditions/ src/app/api/loan-processor/conditions/ src/app/api/underwriter/conditions/
git commit -m "feat(view-as): API guard on conditions/documents/templates routes"
```

---

## Task 20: UI gating — disable high-traffic mutation buttons

**Files (10 high-traffic mutation components — exact file list confirmed by grep in Step 1):**

- [ ] **Step 1: Identify the target components**

Run from `feportal/`:

```bash
grep -rln "onClick" src/components/ | xargs grep -l "fetch\|router.push.*api\|\.from(" | head -20
```

Pick the top ~10 highest-impact mutation surfaces. Expected candidates:
- `src/components/loan-stage-dropdown.tsx` (or equivalent stage-change control)
- `src/components/status-change-button.tsx`
- `src/components/upload-zone.tsx` / `src/components/document-upload-button.tsx`
- `src/components/condition-status-dropdown.tsx`
- `src/components/add-condition-dialog.tsx`
- `src/components/inline-edit-field.tsx` (or equivalent inline edit pattern)
- `src/components/send-email-button.tsx`
- `src/components/sync-button.tsx`
- `src/components/airtable-sync-button.tsx`
- Any other component a Borrower / LO / LP / UW would click to mutate state

(If the exact file names differ, list the actual top-10 found in this codebase and proceed.)

- [ ] **Step 2: Disable each component when impersonating**

For each component, add this pattern:

```tsx
import { useImpersonation } from '@/components/impersonation-provider'

export function StatusChangeButton(...) {
  const { isImpersonating } = useImpersonation()

  return (
    <button
      disabled={isImpersonating || /* existing disabled conditions */}
      title={isImpersonating ? 'Read-only preview — exit View As to act' : undefined}
      onClick={...}
      className={`... ${isImpersonating ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      ...
    </button>
  )
}
```

For dialogs/dropdowns triggered by a button, gate the trigger button. For drag-and-drop upload zones, gate the file-input `onChange` handler:

```tsx
const { isImpersonating } = useImpersonation()
// ...
<input
  type="file"
  disabled={isImpersonating}
  onChange={isImpersonating ? undefined : handleChange}
/>
```

For inline-edit fields, disable the edit-enter affordance (pencil icon / click-to-edit area).

- [ ] **Step 3: Build passes**

Run: `cd feportal && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
cd feportal
git add src/components/
git commit -m "feat(view-as): disable high-traffic mutation controls when impersonating"
```

---

## Task 21: End-to-end verification

This is the Phase 6 verification pass. No new code; only running the checks.

- [ ] **Step 1: Final build clean**

Run: `cd feportal && npm run build`
Expected: build succeeds with no warnings introduced by this work.

- [ ] **Step 2: Manual smoke test — happy path**

Start the dev server (`npm run dev`, port 3100) and sign in as an admin. For each of the 5 target roles (Borrower, Broker, LO, LP, UW):

1. Click "View as" in the header (or press Cmd/Ctrl+K).
2. Search for a known person of that role; click.
3. Confirm: landed on the right home page (`/dashboard`, `/broker`, `/{role}/inbox`).
4. Confirm: yellow banner shows at top with the right name and label.
5. Confirm: page data matches that user's actual data (not the admin's).
6. Confirm: at least one mutation button on the page is visibly disabled with the tooltip.
7. Open dev tools, manually POST to a mutation route (e.g. `/api/loans/notes`) — confirm 403.
8. Click "Exit preview" — confirm redirect to `/admin`, cookie cleared (check Application tab).
9. Confirm: an `admin_impersonation_events` row exists with non-null `ended_at`.

- [ ] **Step 3: `playwright-role-gates` skill**

Invoke the project skill `playwright-role-gates` to confirm no regression in role access patterns. It drives all 5 role sign-ins through their own routes and confirms each role can only reach its own portal.

- [ ] **Step 4: Vercel preview deploy**

```bash
cd feportal
vercel  # creates a preview deployment
```

Open the preview URL and repeat the smoke test for one role (e.g. View-As an LO). Confirm the cookie path / signing works in the deployed environment (where `VIEW_AS_SECRET` may need to be set in Vercel env vars — if missing, set it).

If `VIEW_AS_SECRET` is not yet configured in Vercel, set it via:

```bash
cd feportal
vercel env add VIEW_AS_SECRET production
# paste a strong random string when prompted; repeat for preview env if needed
```

Re-deploy after env change.

- [ ] **Step 5: Final commit (if any verification fixes)**

If any tweaks were needed during verification, commit them:

```bash
cd feportal
git add -A
git commit -m "fix(view-as): verification adjustments"
```

---

## Self-review against the spec

(Run after writing — checked here as part of the plan.)

- ✅ Spec §Database — Task 1 creates `admin_impersonation_events` exactly as specified.
- ✅ Spec §Server changes/cookie — Task 2 creates `view-as-cookie.ts`; Task 3 wires cookie-first resolution + helpers in `impersonate.ts`.
- ✅ Spec §Server changes/endpoints — Tasks 4 (start), 5 (exit), 6 (people), 7 (search) cover all four.
- ✅ Spec §Role pages patched — Tasks 13 (dashboard/broker), 14 (LO), 15 (LP), 16 (UW), 17 (admin) cover all five role trees.
- ✅ Spec §UI — Task 8 (deps), 10 (modal), 11 (trigger), 12 (PortalShell wiring) cover the full picker UI.
- ✅ Spec §Read-only/Layer 1 — Tasks 18 (loans) + 19 (conditions/docs/templates) guard all 20 mutation routes.
- ✅ Spec §Read-only/Layer 2 — Tasks 9 (provider) + 20 (component disabling) cover UI gating.
- ✅ Spec §Verification — Task 21 covers build + manual + playwright-role-gates + preview deploy.

No placeholders remain. All file paths are concrete. Steps have actual code. Function names (`resolveImpersonation`, `readImpersonationCookie`, `assertNotImpersonating`, `getEffectiveRoleRow`, `signViewAsCookie`, `verifyViewAsCookie`, `VIEW_AS_COOKIE`, `useImpersonation`, `ImpersonationProvider`, `AdminViewAsTrigger`, `AdminViewAsModal`) are consistent across tasks.
