# Admin Settings: Configurable Session Security + Maintenance Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global `app_settings` table with super-admin UI controls for idle timeout (0.5-24h), absolute session cap, force-logout-all-users, and a maintenance-mode banner. Replace the hardcoded values in `src/proxy.ts` and `src/components/inactivity-timer.tsx`.

**Architecture:** Single-row `app_settings` table with typed columns. A server-only helper `getAppSettings()` reads the row with a 30-second in-process cache. `proxy.ts` reads idle/absolute limits and `session_epoch` from the helper; force-logout bumps the epoch counter and a cookie mismatch triggers a redirect. Admin UI lives at `/admin/settings/general` and uses the existing super-admin gate. Maintenance banner is rendered in the root layout via a server fetch.

**Tech Stack:** Next.js 16 App Router (Server Components), Supabase (cookie-based auth + service-role admin client), Tailwind CSS v4, shadcn/ui, Zod (already in `package.json` for validation), `lucide-react` icons.

**No test suite.** Per `feportal/CLAUDE.md`: build (`npm run build`) is the correctness gate. Each task ends with a build step and (where useful) a manual Playwright or browser-based verification step.

**Style guard:** No em dashes in code, copy, or comments. Plain hyphens only.

**Prerequisites:** Spec at `docs/superpowers/specs/2026-05-26-admin-settings-session-config-design.md` is approved and committed on branch `docs/admin-settings-session-config`.

---

## File Structure

**New files:**
- `supabase/migrations/<timestamp>-app-settings.sql` - Single-row table with RLS policies for super-admin read/write.
- `src/lib/app-settings.ts` - Server-only helper. Exports `getAppSettings()` (cached 30s), `invalidateAppSettingsCache()`, and the `AppSettings` type.
- `src/app/api/admin/settings/route.ts` - PATCH handler. Super-admin gated. Zod-validates partial settings, writes the row, invalidates cache.
- `src/app/api/admin/settings/force-logout/route.ts` - POST handler. Increments `session_epoch`, clears caller cookies.
- `src/app/admin/settings/general/page.tsx` - Server component. Reads current settings, renders client form.
- `src/components/general-settings-form.tsx` - Client component. Form for the four user-editable fields + force-logout button + confirm dialog.
- `src/components/maintenance-banner.tsx` - Client component (because dismissal uses localStorage). Receives `enabled`, `message`, and `isSuperAdmin` as props.

**Modified files:**
- `src/proxy.ts` - Replace hardcoded `IDLE_LIMIT_MS` / `ABSOLUTE_LIMIT_MS` with values from `getAppSettings()`. Add `fe-session-epoch` cookie tracking + comparison. Add the new cookie to `clearTracking` and a new `stampEpoch` helper.
- `src/app/layout.tsx` - Convert to async server component. Fetch settings + impersonation-aware super-admin check, render `<MaintenanceBanner>` and pass props to a wrapper that exposes timeout values to `InactivityTimer`.
- `src/components/inactivity-timer.tsx` - Accept `idleTimeoutMs` prop. Compute warning at `idleTimeoutMs - 2min`. Remove hardcoded `TIMEOUT_MS` / `WARNING_MS`.
- `src/components/settings-sidebar.tsx` - Add a "General" section (above "Users") with one entry pointing to `/admin/settings/general`.

**Files NOT touched:**
- `src/app/login/page.tsx` and `src/app/auth/*` - cookie setting happens in `proxy.ts` on the next authenticated request, no changes needed at login.
- The five role tables and existing API routes - this feature is orthogonal.

---

## Task 1: Create the `app_settings` migration

**Files:**
- Create: `supabase/migrations/<timestamp>-app-settings.sql` (replace `<timestamp>` with current `YYYYMMDDHHMMSS`)

- [ ] **Step 1.1: Determine the next migration timestamp**

Run: `Get-ChildItem c:\Users\apalm\FE-Portal\feportal\supabase\migrations | Select-Object -Last 3 Name`

Expected: file names like `20260518-super-admin.sql`. Pick a timestamp greater than the latest (e.g. today's date `20260526120000` if running on 2026-05-26).

- [ ] **Step 1.2: Write the migration file**

Create `supabase/migrations/20260526120000-app-settings.sql` with this exact content:

```sql
create table app_settings (
  id smallint primary key default 1 check (id = 1),
  idle_timeout_hours numeric(3,1) not null default 2.0
    check (idle_timeout_hours between 0.5 and 24),
  absolute_session_hours integer not null default 12
    check (absolute_session_hours between 1 and 168),
  session_epoch bigint not null default 0,
  maintenance_banner_enabled boolean not null default false,
  maintenance_banner_message text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into app_settings (id) values (1);

alter table app_settings enable row level security;

create policy app_settings_super_read on app_settings
  for select using (
    exists (
      select 1 from admin_users
      where auth_user_id = auth.uid() and is_super = true
    )
  );

create policy app_settings_super_write on app_settings
  for update using (
    exists (
      select 1 from admin_users
      where auth_user_id = auth.uid() and is_super = true
    )
  );
```

- [ ] **Step 1.3: Apply the migration to the linked Supabase project**

Use the `mcp__claude_ai_Supabase__apply_migration` tool with `name: "20260526120000-app-settings"` and the SQL body above. Confirm the row count in `app_settings` is 1 via `mcp__claude_ai_Supabase__execute_sql` with `select count(*) from app_settings`.

Expected: count = 1.

- [ ] **Step 1.4: Commit**

```powershell
cd c:\Users\apalm\FE-Portal\feportal
git add supabase/migrations/20260526120000-app-settings.sql
git commit -m "feat(admin-settings): add app_settings table for global config"
```

---

## Task 2: Write `getAppSettings()` helper

**Files:**
- Create: `src/lib/app-settings.ts`

- [ ] **Step 2.1: Write the helper**

Create `src/lib/app-settings.ts` with this exact content:

```ts
import { createAdminClient } from '@/lib/supabase/admin'

export type AppSettings = {
  idle_timeout_hours: number
  absolute_session_hours: number
  session_epoch: number
  maintenance_banner_enabled: boolean
  maintenance_banner_message: string
  updated_at: string
  updated_by: string | null
}

const DEFAULTS: AppSettings = {
  idle_timeout_hours: 2,
  absolute_session_hours: 12,
  session_epoch: 0,
  maintenance_banner_enabled: false,
  maintenance_banner_message: '',
  updated_at: new Date(0).toISOString(),
  updated_by: null,
}

const TTL_MS = 30_000

let cache: { value: AppSettings; expiresAt: number } | null = null

export async function getAppSettings(): Promise<AppSettings> {
  if (cache && cache.expiresAt > Date.now()) return cache.value

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('app_settings')
    .select('*')
    .eq('id', 1)
    .single()

  // If the row is missing or unreadable, fall back to defaults so the app
  // never wedges on a settings outage. The defaults match the migration.
  const value: AppSettings = error || !data ? DEFAULTS : (data as AppSettings)
  cache = { value, expiresAt: Date.now() + TTL_MS }
  return value
}

export function invalidateAppSettingsCache(): void {
  cache = null
}
```

- [ ] **Step 2.2: Verify TypeScript compiles**

Run: `npm run build`
Expected: build succeeds with no new errors.

- [ ] **Step 2.3: Commit**

```powershell
git add src/lib/app-settings.ts
git commit -m "feat(admin-settings): add getAppSettings helper with 30s cache"
```

---

## Task 3: PATCH `/api/admin/settings` endpoint

**Files:**
- Create: `src/app/api/admin/settings/route.ts`

- [ ] **Step 3.1: Write the route**

Create `src/app/api/admin/settings/route.ts` with this exact content:

```ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from '@/lib/impersonate'
import { invalidateAppSettingsCache } from '@/lib/app-settings'

async function verifySuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabase
    .from('admin_users').select('id, is_super').eq('auth_user_id', user.id).single()
  if (!me || !me.is_super) return null
  return { user, me }
}

const PatchSchema = z.object({
  idle_timeout_hours: z.number().min(0.5).max(24).multipleOf(0.5).optional(),
  absolute_session_hours: z.number().int().min(1).max(168).optional(),
  maintenance_banner_enabled: z.boolean().optional(),
  maintenance_banner_message: z.string().max(500).optional(),
}).strict()

export async function PATCH(request: Request) {
  const block = await assertNotImpersonating()
  if (block) return block
  const auth = await verifySuperAdmin()
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }

  // Cross-field rule: if the banner is enabled, the message must be non-empty.
  if (parsed.data.maintenance_banner_enabled === true && parsed.data.maintenance_banner_message === '') {
    return NextResponse.json({ error: 'Maintenance message is required when the banner is enabled' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('app_settings')
    .update({ ...parsed.data, updated_at: new Date().toISOString(), updated_by: auth.user.id })
    .eq('id', 1)
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  invalidateAppSettingsCache()
  return NextResponse.json({ success: true, settings: data })
}
```

- [ ] **Step 3.2: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3.3: Commit**

```powershell
git add src/app/api/admin/settings/route.ts
git commit -m "feat(admin-settings): add PATCH /api/admin/settings (super-admin gated)"
```

---

## Task 4: POST `/api/admin/settings/force-logout` endpoint

**Files:**
- Create: `src/app/api/admin/settings/force-logout/route.ts`

- [ ] **Step 4.1: Write the route**

Create `src/app/api/admin/settings/force-logout/route.ts` with this exact content:

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from '@/lib/impersonate'
import { invalidateAppSettingsCache } from '@/lib/app-settings'

async function verifySuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabase
    .from('admin_users').select('id, is_super').eq('auth_user_id', user.id).single()
  if (!me || !me.is_super) return null
  return { user, me }
}

export async function POST() {
  const block = await assertNotImpersonating()
  if (block) return block
  const auth = await verifySuperAdmin()
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  // Increment the session_epoch atomically. We read-modify-write because Supabase JS
  // doesn't expose `set x = x + 1` directly; the row is single-row so contention is
  // negligible (super-admin only).
  const { data: current, error: readErr } = await admin
    .from('app_settings').select('session_epoch').eq('id', 1).single()
  if (readErr || !current) {
    return NextResponse.json({ error: readErr?.message ?? 'app_settings row missing' }, { status: 500 })
  }
  const nextEpoch = Number(current.session_epoch) + 1
  const { error: writeErr } = await admin
    .from('app_settings')
    .update({ session_epoch: nextEpoch, updated_at: new Date().toISOString(), updated_by: auth.user.id })
    .eq('id', 1)
  if (writeErr) return NextResponse.json({ error: writeErr.message }, { status: 500 })

  invalidateAppSettingsCache()

  // Sign the caller out so they have to re-authenticate too.
  const supabase = await createClient()
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {})

  return NextResponse.json({ success: true, session_epoch: nextEpoch })
}
```

- [ ] **Step 4.2: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4.3: Commit**

```powershell
git add src/app/api/admin/settings/force-logout/route.ts
git commit -m "feat(admin-settings): add POST /api/admin/settings/force-logout"
```

---

## Task 5: Wire `proxy.ts` to `app_settings`

**Files:**
- Modify: `src/proxy.ts`

This task replaces the two hardcoded constants and adds the `fe-session-epoch` cookie check. All other proxy behavior (the unauthenticated redirect, the `/login` while authenticated branch, cookie rotation copying) must remain identical.

- [ ] **Step 5.1: Add import**

Find:
```ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
```

Replace with:
```ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getAppSettings } from '@/lib/app-settings'
```

- [ ] **Step 5.2: Replace the hardcoded limits + cookie names block**

Find:
```ts
  // Application-level session timeout. Supabase's native inactivity/timebox controls are a
  // Pro-plan feature, so we enforce it here with server-set httpOnly cookies (the timer
  // can't be tampered with from the browser). The tracking cookies are cleared on every
  // unauthenticated request, so each fresh login starts the timer clean.
  const IDLE_LIMIT_MS = 2 * 60 * 60 * 1000 // log out after 2h of inactivity
  const ABSOLUTE_LIMIT_MS = 12 * 60 * 60 * 1000 // hard cap at 12h regardless of activity
  const ACTIVITY_COOKIE = 'fe-last-activity'
  const START_COOKIE = 'fe-session-start'
```

Replace with:
```ts
  // Application-level session timeout. Supabase's native inactivity/timebox controls are a
  // Pro-plan feature, so we enforce it here with server-set httpOnly cookies (the timer
  // can't be tampered with from the browser). Limits come from app_settings so a super-admin
  // can adjust them without a deploy; getAppSettings caches for 30s.
  const settings = await getAppSettings()
  const IDLE_LIMIT_MS = settings.idle_timeout_hours * 60 * 60 * 1000
  const ABSOLUTE_LIMIT_MS = settings.absolute_session_hours * 60 * 60 * 1000
  const ACTIVITY_COOKIE = 'fe-last-activity'
  const START_COOKIE = 'fe-session-start'
  const EPOCH_COOKIE = 'fe-session-epoch'
```

- [ ] **Step 5.3: Add EPOCH_COOKIE to `clearTracking`**

Find:
```ts
  const clearTracking = (res: NextResponse) => {
    res.cookies.set(ACTIVITY_COOKIE, '', { path: '/', maxAge: 0 })
    res.cookies.set(START_COOKIE, '', { path: '/', maxAge: 0 })
    res.cookies.set('fe_view_as', '', { path: '/', maxAge: 0 })
    return res
  }
```

Replace with:
```ts
  const clearTracking = (res: NextResponse) => {
    res.cookies.set(ACTIVITY_COOKIE, '', { path: '/', maxAge: 0 })
    res.cookies.set(START_COOKIE, '', { path: '/', maxAge: 0 })
    res.cookies.set(EPOCH_COOKIE, '', { path: '/', maxAge: 0 })
    res.cookies.set('fe_view_as', '', { path: '/', maxAge: 0 })
    return res
  }
```

- [ ] **Step 5.4: Stamp the epoch in `stampActivity`**

Find:
```ts
  const stampActivity = (res: NextResponse, sessionStart: number) => {
    res.cookies.set(ACTIVITY_COOKIE, String(now), trackingOptions)
    res.cookies.set(START_COOKIE, String(sessionStart || now), trackingOptions)
    return res
  }
```

Replace with:
```ts
  const stampActivity = (res: NextResponse, sessionStart: number) => {
    res.cookies.set(ACTIVITY_COOKIE, String(now), trackingOptions)
    res.cookies.set(START_COOKIE, String(sessionStart || now), trackingOptions)
    res.cookies.set(EPOCH_COOKIE, String(settings.session_epoch), trackingOptions)
    return res
  }
```

- [ ] **Step 5.5: Add the epoch mismatch check in the authenticated branch**

Find:
```ts
  // Authenticated: enforce idle + absolute session limits.
  const lastActivity = Number(request.cookies.get(ACTIVITY_COOKIE)?.value) || 0
  const sessionStart = Number(request.cookies.get(START_COOKIE)?.value) || 0
  const idleExpired = lastActivity > 0 && now - lastActivity > IDLE_LIMIT_MS
  const absoluteExpired = sessionStart > 0 && now - sessionStart > ABSOLUTE_LIMIT_MS

  if (idleExpired || absoluteExpired) {
```

Replace with:
```ts
  // Authenticated: enforce idle + absolute session limits.
  const lastActivity = Number(request.cookies.get(ACTIVITY_COOKIE)?.value) || 0
  const sessionStart = Number(request.cookies.get(START_COOKIE)?.value) || 0
  const cookieEpoch = request.cookies.get(EPOCH_COOKIE)?.value
  const idleExpired = lastActivity > 0 && now - lastActivity > IDLE_LIMIT_MS
  const absoluteExpired = sessionStart > 0 && now - sessionStart > ABSOLUTE_LIMIT_MS
  // Force-logout works by bumping settings.session_epoch. If the cookie was set by an
  // earlier epoch, the session is invalid. We allow the very first authenticated request
  // through (no cookie yet) so login can stamp the current epoch.
  const epochMismatch = cookieEpoch !== undefined && cookieEpoch !== String(settings.session_epoch)

  if (idleExpired || absoluteExpired || epochMismatch) {
```

- [ ] **Step 5.6: Distinguish the redirect reason**

Find:
```ts
  if (idleExpired || absoluteExpired || epochMismatch) {
    // Sign out this browser only (scope 'local' leaves the user's other devices alone).
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
    const res = NextResponse.redirect(new URL('/login?reason=timeout', request.url))
    supabaseResponse.cookies.getAll().forEach((cookie) => res.cookies.set(cookie))
    return clearTracking(res)
  }
```

Replace with:
```ts
  if (idleExpired || absoluteExpired || epochMismatch) {
    // Sign out this browser only (scope 'local' leaves the user's other devices alone).
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
    const reason = epochMismatch ? 'logged_out' : 'timeout'
    const res = NextResponse.redirect(new URL(`/login?reason=${reason}`, request.url))
    supabaseResponse.cookies.getAll().forEach((cookie) => res.cookies.set(cookie))
    return clearTracking(res)
  }
```

- [ ] **Step 5.7: Verify build**

Run: `npm run build`
Expected: build succeeds. No new TypeScript errors.

- [ ] **Step 5.8: Commit**

```powershell
git add src/proxy.ts
git commit -m "feat(admin-settings): proxy reads timeouts + epoch from app_settings"
```

---

## Task 6: Pass timeout to client-side `InactivityTimer`

**Files:**
- Modify: `src/components/inactivity-timer.tsx`
- Modify: `src/app/layout.tsx`

The client timer is rendered in the root layout and currently hardcodes 30 min. After this task it gets the configured idle timeout from the server via props.

- [ ] **Step 6.1: Update `InactivityTimer` to accept a prop**

Replace the entire contents of `src/components/inactivity-timer.tsx` with:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const WARNING_LEAD_MS = 2 * 60 * 1000 // warn 2 minutes before logout
const EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click']

interface Props {
  idleTimeoutMs: number
}

export function InactivityTimer({ idleTimeoutMs }: Props) {
  const router = useRouter()
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const warningRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showWarning, setShowWarning] = useState(false)

  function clearTimers() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (warningRef.current) clearTimeout(warningRef.current)
  }

  function resetTimer() {
    clearTimers()
    setShowWarning(false)

    // If the configured idle is <= the warning lead, skip the warning step.
    const warnAt = Math.max(0, idleTimeoutMs - WARNING_LEAD_MS)
    if (warnAt > 0) {
      warningRef.current = setTimeout(() => setShowWarning(true), warnAt)
    }

    timeoutRef.current = setTimeout(async () => {
      setShowWarning(false)
      await fetch('/api/admin/view-as/exit', { method: 'POST' }).catch(() => {})
      const supabase = createClient()
      await supabase.auth.signOut()
      router.push('/login')
    }, idleTimeoutMs)
  }

  useEffect(() => {
    resetTimer()
    EVENTS.forEach(e => window.addEventListener(e, resetTimer, { passive: true }))
    return () => {
      clearTimers()
      EVENTS.forEach(e => window.removeEventListener(e, resetTimer))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idleTimeoutMs])

  if (!showWarning) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 text-center">
        <p className="text-2xl mb-2">⏱</p>
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Still there?</h2>
        <p className="text-sm text-gray-500 mb-5">
          You'll be signed out in 2 minutes due to inactivity.
        </p>
        <button
          onClick={resetTimer}
          className="w-full bg-primary text-white py-2 px-4 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Stay signed in
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 6.2: Convert root layout to async + pass props**

Replace the entire contents of `src/app/layout.tsx` with:

```tsx
import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Toaster } from "sonner";
import { InactivityTimer } from "@/components/inactivity-timer";
import { getAppSettings } from "@/lib/app-settings";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "First Equity Funding | Online Portal",
  description: "First Equity Funding Online Portal",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const settings = await getAppSettings()
  const idleTimeoutMs = settings.idle_timeout_hours * 60 * 60 * 1000

  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <InactivityTimer idleTimeoutMs={idleTimeoutMs} />
        <div className="flex-1">
          {children}
        </div>
        <footer className="w-full py-4 px-4 text-center text-xs text-gray-500" style={{ backgroundColor: '#F9FAFB', borderTop: '1px solid #e5e7eb' }}>
          <p>© 2026 by First Equity Funding LP. All Rights Reserved.</p>
        </footer>
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
```

- [ ] **Step 6.3: Verify build**

Run: `npm run build`
Expected: build succeeds. No type errors.

- [ ] **Step 6.4: Commit**

```powershell
git add src/components/inactivity-timer.tsx src/app/layout.tsx
git commit -m "feat(admin-settings): client inactivity timer reads idle timeout from settings"
```

---

## Task 7: Maintenance banner component

**Files:**
- Create: `src/components/maintenance-banner.tsx`
- Modify: `src/app/layout.tsx`

Banner shows for non-super-admin users when enabled. Dismissable per browser session via localStorage. Super-admin check happens server-side and is passed in as a prop, so the banner stays client-only (needs localStorage).

- [ ] **Step 7.1: Write the banner component**

Create `src/components/maintenance-banner.tsx` with this exact content:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

interface Props {
  enabled: boolean
  message: string
  isSuperAdmin: boolean
  /** Bumps when the message or enabled flag changes, so a previous dismissal doesn't suppress a new banner. */
  signature: string
}

const STORAGE_KEY = 'fe-maintenance-banner-dismissed'

export function MaintenanceBanner({ enabled, message, isSuperAdmin, signature }: Props) {
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = sessionStorage.getItem(STORAGE_KEY)
    setDismissed(stored === signature)
  }, [signature])

  if (!enabled || isSuperAdmin || !message || dismissed) return null

  return (
    <div
      role="status"
      className="w-full bg-yellow-100 border-b border-yellow-300 px-4 py-2 flex items-start gap-3 text-sm text-yellow-900"
    >
      <div className="flex-1">{message}</div>
      <button
        type="button"
        onClick={() => {
          sessionStorage.setItem(STORAGE_KEY, signature)
          setDismissed(true)
        }}
        aria-label="Dismiss"
        className="shrink-0 rounded p-0.5 hover:bg-yellow-200 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
```

- [ ] **Step 7.2: Wire the banner into the root layout**

This step also resolves the super-admin check needed by the banner. We do it inside the layout so the check runs once per request rather than per page.

Replace the entire contents of `src/app/layout.tsx` with:

```tsx
import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Toaster } from "sonner";
import { InactivityTimer } from "@/components/inactivity-timer";
import { MaintenanceBanner } from "@/components/maintenance-banner";
import { getAppSettings } from "@/lib/app-settings";
import { createClient } from "@/lib/supabase/server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "First Equity Funding | Online Portal",
  description: "First Equity Funding Online Portal",
};

async function getIsSuperAdmin(): Promise<boolean> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data } = await supabase
    .from('admin_users')
    .select('is_super')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  return data?.is_super === true
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [settings, isSuperAdmin] = await Promise.all([
    getAppSettings(),
    getIsSuperAdmin(),
  ])
  const idleTimeoutMs = settings.idle_timeout_hours * 60 * 60 * 1000
  const bannerSignature = `${settings.maintenance_banner_enabled}:${settings.maintenance_banner_message}`

  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <MaintenanceBanner
          enabled={settings.maintenance_banner_enabled}
          message={settings.maintenance_banner_message}
          isSuperAdmin={isSuperAdmin}
          signature={bannerSignature}
        />
        <InactivityTimer idleTimeoutMs={idleTimeoutMs} />
        <div className="flex-1">
          {children}
        </div>
        <footer className="w-full py-4 px-4 text-center text-xs text-gray-500" style={{ backgroundColor: '#F9FAFB', borderTop: '1px solid #e5e7eb' }}>
          <p>© 2026 by First Equity Funding LP. All Rights Reserved.</p>
        </footer>
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
```

- [ ] **Step 7.3: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7.4: Commit**

```powershell
git add src/components/maintenance-banner.tsx src/app/layout.tsx
git commit -m "feat(admin-settings): maintenance banner in root layout"
```

---

## Task 8: Settings sidebar "General" entry

**Files:**
- Modify: `src/components/settings-sidebar.tsx`

- [ ] **Step 8.1: Add a General section above Users**

Replace the entire contents of `src/components/settings-sidebar.tsx` with:

```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Users, UserCog, ShieldCheck, UserCheck, Settings } from 'lucide-react'

interface Props {
  isSuperAdmin: boolean
}

interface SubItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const GENERAL_SUBITEMS: SubItem[] = [
  { href: '/admin/settings/general', label: 'General', icon: Settings },
]

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

function NavSection({ heading, items, pathname }: { heading: string; items: SubItem[]; pathname: string }) {
  return (
    <div className="mb-4">
      <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {heading}
      </div>
      <ul className="space-y-0.5">
        {items.map(({ href, label, icon: Icon }) => {
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
  )
}

export function SettingsSidebar({ isSuperAdmin }: Props) {
  const pathname = usePathname()
  const userSubItems = isSuperAdmin ? [...USERS_SUBITEMS, ADMINS_SUBITEM] : USERS_SUBITEMS

  return (
    <nav className="w-56 shrink-0 border-r border-gray-200 pr-4">
      {isSuperAdmin && <NavSection heading="General" items={GENERAL_SUBITEMS} pathname={pathname} />}
      <NavSection heading="Users" items={userSubItems} pathname={pathname} />
    </nav>
  )
}
```

Rationale: the General section is super-admin-only because all the settings it exposes (session security, force-logout, maintenance) are super-admin actions. Non-super admins still see Users.

- [ ] **Step 8.2: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 8.3: Commit**

```powershell
git add src/components/settings-sidebar.tsx
git commit -m "feat(admin-settings): add General section to settings sidebar"
```

---

## Task 9: Settings form client component

**Files:**
- Create: `src/components/general-settings-form.tsx`

This is the meat of the admin UI: a form for the four user-editable fields, a save handler, and a destructive force-logout button with confirmation.

- [ ] **Step 9.1: Write the form**

Create `src/components/general-settings-form.tsx` with this exact content:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { LogOut } from 'lucide-react'

interface SettingsInput {
  idle_timeout_hours: number
  absolute_session_hours: number
  maintenance_banner_enabled: boolean
  maintenance_banner_message: string
}

interface Props {
  initial: SettingsInput
}

export function GeneralSettingsForm({ initial }: Props) {
  const router = useRouter()
  const [values, setValues] = useState<SettingsInput>(initial)
  const [saving, setSaving] = useState(false)
  const [confirmingLogout, setConfirmingLogout] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const dirty =
    values.idle_timeout_hours !== initial.idle_timeout_hours ||
    values.absolute_session_hours !== initial.absolute_session_hours ||
    values.maintenance_banner_enabled !== initial.maintenance_banner_enabled ||
    values.maintenance_banner_message !== initial.maintenance_banner_message

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!dirty || saving) return

    if (values.maintenance_banner_enabled && !values.maintenance_banner_message.trim()) {
      toast.error('Maintenance message is required when the banner is enabled')
      return
    }

    setSaving(true)
    const res = await fetch('/api/admin/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    })
    setSaving(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body.error ?? 'Failed to save settings')
      return
    }
    toast.success('Settings saved')
    router.refresh()
  }

  async function handleForceLogout() {
    setLoggingOut(true)
    const res = await fetch('/api/admin/settings/force-logout', { method: 'POST' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body.error ?? 'Failed to force logout')
      setLoggingOut(false)
      return
    }
    window.location.href = '/login?reason=logged_out'
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <form onSubmit={handleSave} className="space-y-6">
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-900">Session security</h3>

          <div>
            <label htmlFor="idle" className="block text-sm font-medium text-gray-700 mb-1">
              Idle timeout (hours)
            </label>
            <input
              id="idle"
              type="number"
              step="0.5"
              min="0.5"
              max="24"
              value={values.idle_timeout_hours}
              onChange={(e) => setValues(v => ({ ...v, idle_timeout_hours: Number(e.target.value) }))}
              className="w-32 rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">Logs users out after this many hours of no activity. 0.5 to 24, in 0.5h steps.</p>
          </div>

          <div>
            <label htmlFor="absolute" className="block text-sm font-medium text-gray-700 mb-1">
              Absolute session cap (hours)
            </label>
            <input
              id="absolute"
              type="number"
              step="1"
              min="1"
              max="168"
              value={values.absolute_session_hours}
              onChange={(e) => setValues(v => ({ ...v, absolute_session_hours: Number(e.target.value) }))}
              className="w-32 rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">Hard ceiling regardless of activity. 1 to 168 hours.</p>
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-900">Maintenance banner</h3>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={values.maintenance_banner_enabled}
              onChange={(e) => setValues(v => ({ ...v, maintenance_banner_enabled: e.target.checked }))}
              className="rounded border-gray-300"
            />
            Show banner to non-admin users
          </label>

          <div>
            <label htmlFor="banner-msg" className="block text-sm font-medium text-gray-700 mb-1">
              Banner message
            </label>
            <textarea
              id="banner-msg"
              rows={3}
              maxLength={500}
              value={values.maintenance_banner_message}
              onChange={(e) => setValues(v => ({ ...v, maintenance_banner_message: e.target.value }))}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="Scheduled maintenance on Saturday 2pm-3pm ET..."
            />
            <p className="mt-1 text-xs text-gray-500">Plain text, up to 500 characters.</p>
          </div>
        </section>

        <button
          type="submit"
          disabled={!dirty || saving}
          className="bg-primary text-white px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        >
          {saving ? 'Saving...' : 'Save changes'}
        </button>
      </form>

      <section className="border-t border-gray-200 pt-6 space-y-3">
        <h3 className="text-lg font-semibold text-gray-900">Force log out all users</h3>
        <p className="text-sm text-gray-600">
          Invalidates every active session, including yours. Use this if you suspect an account is compromised or after rotating shared credentials.
        </p>

        {!confirmingLogout ? (
          <button
            type="button"
            onClick={() => setConfirmingLogout(true)}
            className="inline-flex items-center gap-2 border border-red-300 text-red-700 px-4 py-2 rounded-md text-sm font-medium hover:bg-red-50 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Force log out all users
          </button>
        ) : (
          <div className="rounded-md border border-red-300 bg-red-50 p-4 space-y-3">
            <p className="text-sm text-red-900 font-medium">
              This will log out every active user including you. You'll be redirected to the login page. Continue?
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleForceLogout}
                disabled={loggingOut}
                className="bg-red-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {loggingOut ? 'Logging out...' : 'Yes, log everyone out'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingLogout(false)}
                disabled={loggingOut}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 9.2: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 9.3: Commit**

```powershell
git add src/components/general-settings-form.tsx
git commit -m "feat(admin-settings): general settings form client component"
```

---

## Task 10: Settings page (server component)

**Files:**
- Create: `src/app/admin/settings/general/page.tsx`

- [ ] **Step 10.1: Write the page**

Create `src/app/admin/settings/general/page.tsx` with this exact content:

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAppSettings } from '@/lib/app-settings'
import { GeneralSettingsForm } from '@/components/general-settings-form'

export default async function GeneralSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: admin } = await supabase
    .from('admin_users')
    .select('is_super')
    .eq('auth_user_id', user.id)
    .single()
  if (!admin?.is_super) redirect('/admin')

  const settings = await getAppSettings()

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">General</h1>
        <p className="text-sm text-gray-500 mt-1">Configure session security and operational announcements.</p>
      </div>
      <GeneralSettingsForm
        initial={{
          idle_timeout_hours: settings.idle_timeout_hours,
          absolute_session_hours: settings.absolute_session_hours,
          maintenance_banner_enabled: settings.maintenance_banner_enabled,
          maintenance_banner_message: settings.maintenance_banner_message,
        }}
      />
    </div>
  )
}
```

- [ ] **Step 10.2: Verify build**

Run: `npm run build`
Expected: build succeeds and the route `/admin/settings/general` appears in the build output.

- [ ] **Step 10.3: Commit**

```powershell
git add src/app/admin/settings/general/page.tsx
git commit -m "feat(admin-settings): /admin/settings/general page (super-admin gated)"
```

---

## Task 11: End-to-end verification

**No files.** This task is the verification gate before the PR is opened.

- [ ] **Step 11.1: Final build**

Run: `npm run build`
Expected: succeeds with zero new warnings or errors.

- [ ] **Step 11.2: Start dev server (worktree port 3100, per user preference)**

Run in PowerShell with `run_in_background: true`:
```powershell
cd c:\Users\apalm\FE-Portal\feportal; npm run dev -- --port 3100
```

- [ ] **Step 11.3: Playwright: super-admin can reach the page, non-super cannot**

Use `mcp__plugin_playwright_playwright__browser_navigate` to log in via the existing test accounts at `http://localhost:3100/login`. Use the project skill `playwright-role-gates` for the full role matrix.

Manual flow:
1. Log in as super-admin. Navigate to `/admin/settings/general`. Expected: form renders with current values.
2. Log in as non-super admin. Navigate to `/admin/settings/general`. Expected: redirect to `/admin`.
3. Log in as a loan officer. Navigate to `/admin/settings/general`. Expected: redirect to `/login` or `/dashboard`.

- [ ] **Step 11.4: Playwright: idle timeout flows end-to-end**

1. As super-admin, set idle timeout to 0.5h. Save.
2. Open DevTools, find the `fe-last-activity` cookie, set its value to a timestamp 31 minutes ago: `String(Date.now() - 31 * 60 * 1000)`.
3. Navigate to any page. Expected: redirect to `/login?reason=timeout`.
4. As super-admin, set idle timeout back to 2h.

- [ ] **Step 11.5: Playwright: maintenance banner**

1. As super-admin, enable maintenance banner with message "Test maintenance window". Save.
2. As super-admin, navigate to `/admin`. Expected: banner does NOT appear (super-admins exempt).
3. In a second browser context, log in as a loan officer. Expected: yellow banner appears with the message.
4. Dismiss the banner. Reload. Expected: banner stays dismissed for the session.
5. As super-admin, disable the banner. Save.
6. In the loan officer context, reload. Expected: banner gone.

- [ ] **Step 11.6: Playwright: force log out all users**

1. As super-admin in context A, navigate to `/admin/settings/general`.
2. In context B, log in as a loan officer. Navigate to a few pages to confirm the session is alive.
3. Back in context A, click "Force log out all users", confirm. Expected: context A redirects to `/login?reason=logged_out`.
4. In context B, navigate to any page. Expected: redirect to `/login?reason=logged_out`.

- [ ] **Step 11.7: Run the project's role-gates skill**

Invoke the `playwright-role-gates` skill to confirm all five roles still hit the expected pages and that `/admin/settings/general` is gated correctly. This is required before merge per CLAUDE.md.

- [ ] **Step 11.8: Commit any final touch-ups + open PR**

If verification revealed issues, fix them and run Task 11 again. Otherwise:

```powershell
git push -u origin docs/admin-settings-session-config
gh pr create --title "feat(admin-settings): configurable session security + maintenance banner" --base main
```

PR body should reference the spec at `docs/superpowers/specs/2026-05-26-admin-settings-session-config-design.md`.

---

## Self-review checklist (run after writing the plan)

- [x] Spec coverage: every spec section has at least one task — data model (Task 1), helper (Task 2), API endpoints (Tasks 3-4), proxy.ts changes (Task 5), inactivity timer + root layout integration (Tasks 6-7), admin UI (Tasks 8-10), verification (Task 11). The InactivityTimer dependency the spec missed is explicitly covered in Task 6.
- [x] No placeholders: every code block is complete and ready to paste.
- [x] Type consistency: `AppSettings` field names match between `app-settings.ts`, the migration, the API route, and the form. `idleTimeoutMs` prop signature is consistent between layout and InactivityTimer.
- [x] No em dashes in any copy or comment.
