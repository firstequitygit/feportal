# Collapsible Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (the work is tightly coupled in one main file, so inline execution fits better than subagent-per-task). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the FE-Portal left sidebar collapsible to an icon rail that expands as a floating overlay on hover, with a user-pinnable open state that persists across sessions.

**Architecture:** All collapse logic lives in `src/components/portal-shell.tsx`. The already-`fixed` `<aside>` animates its width via a derived `expanded = pinned || mouseOver || focusWithin`; `<main>`'s left margin tracks only `pinned`, so hover-expansion overlays content instead of reflowing it. The four footer action button components gain a `collapsed` prop that renders an icon-only variant in the rail and their existing text/form variant when expanded.

**Tech Stack:** Next.js 16 (client component), Tailwind CSS v4, shadcn/ui Button (`@base-ui/react`), lucide-react icons, `localStorage` for persistence. No test suite — `npm run build` plus Playwright are the correctness gates.

---

## File Structure

- Modify: `src/components/portal-shell.tsx` — core collapse/pin state, layout, pin toggle, label hiding (Task 1); wire `collapsed` prop into footer (Task 2).
- Modify: `src/components/sync-button.tsx` — add `collapsed` prop + icon variant (Task 2).
- Modify: `src/components/airtable-sync-button.tsx` — add `collapsed` prop + icon variant (Task 2).
- Modify: `src/components/invite-borrower.tsx` — add `collapsed` prop + icon variant (Task 2).
- Modify: `src/components/invite-broker.tsx` — add `collapsed` prop + icon variant (Task 2).

No page, route, layout, or auth files change. Mobile drawer behavior is untouched.

---

## Task 1: Core collapse / pin state in PortalShell

**Files:**
- Modify: `src/components/portal-shell.tsx`

- [ ] **Step 1: Add `useEffect` and pin icons to imports**

Change line 3 and lines 12-16 of `src/components/portal-shell.tsx`:

```tsx
import { useEffect, useState } from 'react'
```

```tsx
import {
  LayoutDashboard, LogOut, Menu, X, Pin, PinOff,
  Users, UserCog, ShieldCheck, ClipboardList, Archive, FileCheck,
  Inbox, Building2, BarChart3, UserCircle, Briefcase, Store,
} from 'lucide-react'
```

- [ ] **Step 2: Add collapse/pin state and helpers**

Replace the existing single state line (currently `const [open, setOpen] = useState(false)`, line 97) with:

```tsx
  const [open, setOpen] = useState(false)          // mobile drawer (unchanged)
  const [pinned, setPinned] = useState(true)       // desktop pin; default = today's look
  const [mouseOver, setMouseOver] = useState(false)
  const [focusWithin, setFocusWithin] = useState(false)
  const expanded = pinned || mouseOver || focusWithin
```

Then, immediately after the `const supabase = createClient()` line, add:

```tsx
  // Restore the user's last pinned/collapsed choice. localStorage is unavailable
  // during SSR, so read after mount (mirrors the DataGrid persistence pattern).
  useEffect(() => {
    try {
      const saved = localStorage.getItem('sidebar:pinned')
      if (saved !== null) setPinned(JSON.parse(saved) as boolean)
    } catch { /* ignore corrupt storage */ }
  }, [])

  function togglePinned() {
    setPinned(prev => {
      const next = !prev
      try { localStorage.setItem('sidebar:pinned', JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }
```

- [ ] **Step 3: Add hover/focus handlers and width classes to the `<aside>`**

Replace the opening `<aside ...>` tag (lines 162-167) with:

```tsx
      <aside
        onMouseEnter={() => setMouseOver(true)}
        onMouseLeave={() => setMouseOver(false)}
        onFocus={() => setFocusWithin(true)}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocusWithin(false) }}
        className={`
        fixed inset-y-0 left-0 z-30 w-60 bg-white border-r border-gray-200 flex flex-col
        transition-all duration-200 ease-in-out
        ${open ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0
        ${expanded ? 'md:w-60' : 'md:w-16'}
        ${!pinned && expanded ? 'md:shadow-xl' : ''}
      `}>
```

- [ ] **Step 4: Make the user block collapse-aware and add the pin toggle**

Replace the user block (lines 178-189) with:

```tsx
        {/* User + desktop pin toggle — sits at the very top of the sidebar */}
        <div className="px-3 py-4 border-b border-gray-100 mt-14 md:mt-0">
          <div className={`flex items-center ${expanded ? 'gap-3' : 'md:justify-center'}`}>
            <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-white text-sm font-bold flex-shrink-0 select-none">
              {initials}
            </div>
            <div className={`min-w-0 flex-1 ${!expanded ? 'md:hidden' : ''}`}>
              <p className="text-sm font-semibold text-gray-900 truncate leading-tight">{displayName}</p>
              <p className="text-xs text-gray-500 leading-tight mt-0.5">{userRole}</p>
            </div>
            <button
              onClick={togglePinned}
              className={`hidden md:inline-flex p-1 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 flex-shrink-0 ${!expanded ? 'md:hidden' : ''}`}
              aria-label={pinned ? 'Collapse sidebar' : 'Pin sidebar open'}
              title={pinned ? 'Collapse sidebar' : 'Pin sidebar open'}
            >
              {pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
            </button>
          </div>
        </div>
```

Note: the pin toggle is shown only when `expanded`. In the collapsed rail it is hidden, but hovering expands the rail (revealing it) so the user can always pin. This keeps the collapsed rail clean and the pinned view nearly identical to today.

- [ ] **Step 5: Hide nav labels and center icons when collapsed**

Replace the nav `<Link>` (lines 196-208) with:

```tsx
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                } ${expanded ? 'px-3' : 'px-3 md:justify-center md:px-0'}`}
                title={!expanded ? label : undefined}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className={!expanded ? 'md:hidden' : ''}>{label}</span>
              </Link>
```

- [ ] **Step 6: Make the Sign out button collapse-aware**

Replace the Sign out button (lines 229-235) with:

```tsx
          <button
            onClick={handleLogout}
            className={`flex items-center gap-3 py-2.5 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors w-full ${expanded ? 'px-3' : 'px-3 md:justify-center md:px-0'}`}
            title={!expanded ? 'Sign out' : undefined}
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            <span className={!expanded ? 'md:hidden' : ''}>Sign out</span>
          </button>
```

- [ ] **Step 7: Track sidebar width on main content**

Replace the `<main>` opening tag (line 240) with:

```tsx
      <main className={`min-h-screen bg-gray-50 transition-all duration-200 ${pinned ? 'md:ml-60' : 'md:ml-16'}`}>
```

- [ ] **Step 8: Build to verify no type/lint errors**

Run: `npm run build`
Expected: build completes successfully (TypeScript + ESLint pass). Footer action buttons are not yet collapse-aware — that is Task 2; the build must still pass.

- [ ] **Step 9: Commit**

```bash
git add src/components/portal-shell.tsx
git commit -m "feat(sidebar): collapsible icon rail with hover overlay and pin toggle"
```

---

## Task 2: Footer action buttons degrade to icons in the rail

The footer cluster (`SyncButton`, `AirtableSyncButton`, `InviteBorrower`, `InviteBroker`) renders text-only buttons. Each gets a `collapsed` prop: when `true`, render an icon-only `size="icon-sm"` button; when `false`, render the existing behavior unchanged (so the pinned view is identical to today). PortalShell passes `collapsed={!expanded}`.

**Files:**
- Modify: `src/components/sync-button.tsx`
- Modify: `src/components/airtable-sync-button.tsx`
- Modify: `src/components/invite-borrower.tsx`
- Modify: `src/components/invite-broker.tsx`
- Modify: `src/components/portal-shell.tsx`

- [ ] **Step 1: SyncButton — add `collapsed` prop and icon variant**

In `src/components/sync-button.tsx`, add to the imports:

```tsx
import { RefreshCw } from 'lucide-react'
```

Change the signature `export function SyncButton() {` to:

```tsx
export function SyncButton({ collapsed = false }: { collapsed?: boolean } = {}) {
```

Replace the returned `<Button>` (lines 31-35) with:

```tsx
  if (collapsed) {
    return (
      <Button variant="outline" size="icon-sm" onClick={handleSync} disabled={syncing}
        aria-label="Sync Pipedrive" title="Sync Pipedrive">
        <RefreshCw className={syncing ? 'animate-spin' : ''} />
      </Button>
    )
  }

  return (
    <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
      {syncing ? 'Syncing…' : 'Sync Pipedrive'}
    </Button>
  )
```

- [ ] **Step 2: AirtableSyncButton — add `collapsed` prop and icon variant**

In `src/components/airtable-sync-button.tsx`, add to the imports:

```tsx
import { Database } from 'lucide-react'
```

Change the signature `export function AirtableSyncButton() {` to:

```tsx
export function AirtableSyncButton({ collapsed = false }: { collapsed?: boolean } = {}) {
```

Replace the returned `<Button>` (lines 51-55) with:

```tsx
  if (collapsed) {
    return (
      <Button variant="outline" size="icon-sm" onClick={handleSync} disabled={syncing}
        aria-label="Sync Airtable" title="Sync Airtable">
        <Database className={syncing ? 'animate-pulse' : ''} />
      </Button>
    )
  }

  return (
    <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
      {syncing ? 'Syncing…' : 'Sync Airtable'}
    </Button>
  )
```

- [ ] **Step 3: InviteBorrower — add `collapsed` prop and icon trigger**

In `src/components/invite-borrower.tsx`, add to the imports:

```tsx
import { UserPlus } from 'lucide-react'
```

Change the signature to add `collapsed`:

```tsx
export function InviteBorrower({ apiEndpoint = '/api/invite', collapsed = false }: { apiEndpoint?: string; collapsed?: boolean } = {}) {
```

Replace the `if (!open) { ... }` trigger block (lines 65-71) with:

```tsx
  if (!open) {
    if (collapsed) {
      return (
        <Button variant="outline" size="icon-sm" onClick={() => setOpen(true)}
          aria-label="Invite Borrower" title="Invite Borrower">
          <UserPlus />
        </Button>
      )
    }
    return (
      <Button variant="outline" onClick={() => setOpen(true)} size="sm">
        Invite Borrower
      </Button>
    )
  }
```

The open `Card` form is unchanged. By the time a user clicks the trigger they have hovered the rail (so it is expanded and `collapsed` is `false`); the icon branch is purely the static-rail appearance.

- [ ] **Step 4: InviteBroker — add `collapsed` prop and icon trigger**

In `src/components/invite-broker.tsx`, add to the imports:

```tsx
import { UserPlus } from 'lucide-react'
```

Change the signature to add `collapsed`:

```tsx
export function InviteBroker({ apiEndpoint = '/api/invite-broker', collapsed = false }: { apiEndpoint?: string; collapsed?: boolean } = {}) {
```

Replace the `if (!open) { ... }` trigger block (lines 66-72) with:

```tsx
  if (!open) {
    if (collapsed) {
      return (
        <Button variant="outline" size="icon-sm" onClick={() => setOpen(true)}
          aria-label="Invite Broker" title="Invite Broker">
          <UserPlus />
        </Button>
      )
    }
    return (
      <Button variant="outline" onClick={() => setOpen(true)} size="sm">
        Invite Broker
      </Button>
    )
  }
```

- [ ] **Step 5: Wire `collapsed` into the footer cluster in PortalShell**

In `src/components/portal-shell.tsx`, replace the footer action `<div>` block (lines 214-225) with:

```tsx
        {(variant === 'admin' || variant === 'loan-officer' || variant === 'loan-processor' || variant === 'underwriter') && (
          <div className={`px-3 pb-3 border-t border-gray-100 pt-3 flex flex-col gap-2 ${expanded ? 'items-start' : 'items-start md:items-center'}`}>
            <SyncButton collapsed={!expanded} />
            {variant === 'admin' && <AirtableSyncButton collapsed={!expanded} />}
            {variant === 'admin' && <InviteBorrower apiEndpoint="/api/invite" collapsed={!expanded} />}
            {variant === 'admin' && <InviteBroker apiEndpoint="/api/invite-broker" collapsed={!expanded} />}
            {variant === 'loan-officer' && <InviteBorrower apiEndpoint="/api/loan-officer/invite" collapsed={!expanded} />}
            {variant === 'loan-officer' && <InviteBroker apiEndpoint="/api/loan-officer/invite-broker" collapsed={!expanded} />}
            {variant === 'loan-processor' && <InviteBorrower apiEndpoint="/api/loan-processor/invite" collapsed={!expanded} />}
            {variant === 'loan-processor' && <InviteBroker apiEndpoint="/api/loan-processor/invite-broker" collapsed={!expanded} />}
          </div>
        )}
```

- [ ] **Step 6: Build to verify**

Run: `npm run build`
Expected: build completes successfully (TypeScript + ESLint pass).

- [ ] **Step 7: Commit**

```bash
git add src/components/sync-button.tsx src/components/airtable-sync-button.tsx src/components/invite-borrower.tsx src/components/invite-broker.tsx src/components/portal-shell.tsx
git commit -m "feat(sidebar): footer action buttons collapse to icons in the rail"
```

---

## Task 3: Verify end-to-end

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: server starts on http://localhost:3000 (or the next free port).

- [ ] **Step 2: Drive the desktop flow with Playwright**

Log in as one staff role (admin or loan-officer). At a desktop viewport (e.g. 1280x800) confirm:
- Default load shows the full pinned sidebar (first-ever load) or the last-saved state.
- Clicking the pin toggle (`PinOff`) collapses the sidebar to the `w-16` icon rail; `<main>` widens to `md:ml-16`.
- Hovering the collapsed rail expands it to `w-60` as an overlay **with a shadow, floating over the page content** (content does not shift). Moving the mouse away re-collapses it.
- The footer Sync / Invite buttons appear as icons in the rail and as full labeled buttons when expanded; clicking Invite (while expanded) opens its form.
- Clicking the pin toggle again (`Pin`) re-pins it to the full layout.
- Reloading the page preserves the last pinned/collapsed choice (`localStorage` `sidebar:pinned`).

Capture a screenshot of each of the three states (pinned, collapsed, hover-overlay).

- [ ] **Step 3: Spot-check mobile**

Resize to a mobile viewport (e.g. 390x844). Confirm the hamburger opens the full-width drawer exactly as before and the collapse/pin controls do not interfere.

- [ ] **Step 4: Confirm intent**

Restate: "collapsible left nav — icon rail collapsed, hover expands as an overlay over content, pin keeps it open like today." Confirm the screenshots demonstrate exactly this.

---

## Self-Review Notes

- **Spec coverage:** three states (Task 1 Steps 3,7 + Task 3), localStorage persistence (Task 1 Step 2), pin control at top of sidebar (Task 1 Step 4), icons-in-rail footer (Task 2), `focus-within` a11y (Task 1 Step 3 via `onFocus`/`onBlur`), mobile untouched (all collapse classes `md:`-scoped). No tooltip library (uses native `title`). All covered.
- **Type consistency:** `collapsed?: boolean` prop name and `expanded`/`pinned` derivations are consistent across all five files; `collapsed={!expanded}` is the single wiring point.
- **No placeholders:** every code step shows the exact replacement code and the lines it replaces.
- **Risk:** no auth/route/page files touched, so no role-gate regression surface; `npm run build` plus the Playwright walkthrough are the gates (project has no unit tests).
