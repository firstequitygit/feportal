# Loans Board View Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Loans board view so all 7 pipeline columns fit a desktop screen, the horizontal scrollbar is always visible at the viewport bottom, and cards show the same color-coded accent + outstanding-action chips that the list view uses.

**Architecture:** Presentation-only refactor of `BoardView` inside `loan-list-sorted.tsx`. Two new components (`BoardLoanCard`, `BoardScrollbar`) extract concerns from the inline card markup. A new `src/lib/format.ts` adds a compact-currency helper. Mobile fallback hides the Board toggle below the `sm` breakpoint instead of taking a toast dependency.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind CSS v4, shadcn/ui, lucide-react icons. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-01-loans-board-view-redesign-design.md`

**Note for the engineer:** This project has **no automated test suite**. `npm run build` is the correctness gate. Skip TDD; instead, run the build between tasks. There is no Jest, no Vitest, no Playwright in CI. Manual browser verification happens at the end via the dev server.

**Commit style:** Squash-merge repo. Make small, descriptive commits as you go - they will be squashed at PR time. Use Conventional Commits prefix (`feat:`, `refactor:`, etc.) - match repo convention (check `git log --oneline -10` if unsure).

**Branch:** Work on `feat/loans-board-compact` off `main`. The user prefers one feature per branch.

---

## File structure

After this plan completes:

- `src/lib/format.ts` (**new**) - exports `formatCurrency` and `formatCompactCurrency`. Single responsibility: money formatting.
- `src/components/loans/board-loan-card.tsx` (**new**) - compact card for board columns. Owns the accent + chip logic mirroring LoanCard.
- `src/components/loans/board-scrollbar.tsx` (**new**) - viewport-bottom horizontal scroll proxy. Owns the scroll-sync behavior.
- `src/components/loan-list-sorted.tsx` (modify) - BoardView function only (lines 254-305). Uses the three new modules.
- `src/components/loans/loan-list-toolbar.tsx` (modify) - one Tailwind change on the Board button (lines 217-226).

Existing `LoanCard.formatCurrency` (lines 21-28) is **intentionally left duplicated**. Refactoring it into `src/lib/format.ts` would be scope creep; the only caller affected by this work is the board view.

---

## Task 1: Add compact currency formatter

**Files:**
- Create: `src/lib/format.ts`

**Why this task is first:** Both Task 2 (`BoardLoanCard`) and Task 4 (BoardView column header) import from this file. Doing it standalone first means the next two tasks can run in parallel.

- [ ] **Step 1: Create `src/lib/format.ts`**

Write the file with this exact content:

```ts
// src/lib/format.ts

export function formatCurrency(val: number | null | undefined): string {
  if (val === null || val === undefined) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(val)
}

/**
 * Compact currency for tight UI surfaces. Examples:
 *   0          -> "$0"
 *   1,500      -> "$1.5K"
 *   260,480    -> "$260K"
 *   2_501_750  -> "$2.5M"
 *   1_400_000_000 -> "$1.4B"
 */
export function formatCompactCurrency(val: number | null | undefined): string {
  if (val === null || val === undefined) return '—'
  if (val === 0) return '$0'
  const abs = Math.abs(val)
  if (abs < 1000) return `$${Math.round(val)}`
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(val)
}
```

- [ ] **Step 2: Verify the file compiles**

Run from `feportal/`:

```
npm run build
```

Expected: build passes (the new file is not yet imported anywhere, so this is purely a syntax check).

- [ ] **Step 3: Commit**

```
git add src/lib/format.ts
git commit -m "feat: add compact currency formatter"
```

---

## Task 2: Create BoardLoanCard component

**Files:**
- Create: `src/components/loans/board-loan-card.tsx`

**Why a separate component:** The board card has different layout (two tight lines, no stage badge, no chevron, narrower) and different content priorities than `LoanCard`. Sharing one component would force conditional layout flags that hurt readability. The shared logic (accent color, status precedence) is small and tolerable to duplicate.

- [ ] **Step 1: Create `src/components/loans/board-loan-card.tsx`**

```tsx
// src/components/loans/board-loan-card.tsx
'use client'

import Link from 'next/link'
import { type Loan, type OutstandingCounts } from '@/lib/types'
import { formatCompactCurrency } from '@/lib/format'

type BoardLoanCardLoan = Loan & {
  borrowers?: { full_name: string | null; email: string } | null
}

interface Props {
  loan: BoardLoanCardLoan
  outstanding: OutstandingCounts
  linkPrefix: string
}

const ZERO: OutstandingCounts = { you: 0, borrower: 0, team: 0, total: 0 }

function accentClass(loan: BoardLoanCardLoan, outstanding: OutstandingCounts): string {
  if (loan.loan_status === 'cancelled') return 'border-l-red-300'
  if (loan.loan_status === 'on_hold') return 'border-l-amber-400'
  if (loan.pipeline_stage === 'Closed') return 'border-l-gray-300'
  if (outstanding.you > 0) return 'border-l-red-400'
  if (outstanding.total > 0) return 'border-l-amber-300'
  return 'border-l-green-400'
}

interface ChipDescriptor {
  text: string
  className: string
}

function statusChip(loan: BoardLoanCardLoan, outstanding: OutstandingCounts): ChipDescriptor | null {
  if (loan.loan_status === 'cancelled') {
    return { text: 'Cancelled', className: 'bg-red-100 text-red-700' }
  }
  if (loan.loan_status === 'on_hold') {
    return { text: 'On Hold', className: 'bg-amber-100 text-amber-800' }
  }
  if (outstanding.you > 0) {
    return { text: `You ${outstanding.you}`, className: 'bg-red-100 text-red-700' }
  }
  if (outstanding.borrower > 0) {
    return { text: `Borrower ${outstanding.borrower}`, className: 'bg-amber-100 text-amber-700' }
  }
  if (outstanding.team > 0) {
    return { text: `Team ${outstanding.team}`, className: 'bg-gray-100 text-gray-600' }
  }
  return null
}

export function BoardLoanCard({ loan, outstanding = ZERO, linkPrefix }: Props) {
  const accent = accentClass(loan, outstanding)
  const chip = statusChip(loan, outstanding)
  const isDimmed = loan.loan_status === 'cancelled' || loan.pipeline_stage === 'Closed'

  return (
    <Link
      href={`${linkPrefix}/loans/${loan.id}`}
      className={`block group rounded-md border border-gray-200 border-l-4 ${accent} bg-white p-2 transition-all duration-150 hover:shadow-sm hover:border-gray-300 ${
        isDimmed ? 'opacity-70' : ''
      } ${loan.loan_status === 'on_hold' ? 'bg-amber-50/40' : ''}`}
    >
      <div className="flex items-baseline justify-between gap-1.5">
        <p className="text-xs font-semibold text-gray-900 leading-tight truncate min-w-0 flex-1">
          {loan.property_address ?? 'Address not set'}
        </p>
        <p className="text-xs font-semibold text-gray-900 whitespace-nowrap">
          {formatCompactCurrency(loan.loan_amount)}
        </p>
      </div>
      <div className="flex items-center justify-between gap-1.5 mt-0.5">
        <p className="text-[11px] text-gray-500 truncate min-w-0 flex-1">
          {loan.borrowers?.full_name ?? <span className="italic">Unassigned</span>}
          {loan.loan_type ? <span className="text-gray-300"> · </span> : null}
          {loan.loan_type}
        </p>
        {chip && (
          <span
            className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${chip.className}`}
          >
            {chip.text}
          </span>
        )}
      </div>
    </Link>
  )
}
```

Layout notes:
- Two lines, both `text-xs`/`text-[11px]` so the card is ~52px tall at default density.
- `border-l-4` matches LoanCard's accent stripe; the color comes from `accentClass`.
- Stage badge is **intentionally omitted** - the column header conveys stage.
- No chevron icon - the whole `<Link>` is the click target and hover provides feedback.

- [ ] **Step 2: Verify build**

```
npm run build
```

Expected: build passes. The component is not yet referenced anywhere, so this confirms the imports and types are correct.

- [ ] **Step 3: Commit**

```
git add src/components/loans/board-loan-card.tsx
git commit -m "feat: add BoardLoanCard for compact pipeline columns"
```

---

## Task 3: Create BoardScrollbar component

**Files:**
- Create: `src/components/loans/board-scrollbar.tsx`

**Why a separate component:** The scroll proxy involves three pieces of state (resize observer, scroll sync ref guard, visibility gate). Inlining into BoardView would add ~40 lines of effects and refs and obscure the column-rendering logic.

- [ ] **Step 1: Create `src/components/loans/board-scrollbar.tsx`**

```tsx
// src/components/loans/board-scrollbar.tsx
'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'

interface Props {
  /** Ref to the horizontally-scrolling board container. */
  boardRef: RefObject<HTMLDivElement | null>
}

/**
 * Sticky horizontal scrollbar pinned to the bottom of the viewport.
 *
 * Mirrors the scroll position of `boardRef`. Visible whenever the board's
 * scrollWidth exceeds its clientWidth. Hidden otherwise.
 */
export function BoardScrollbar({ boardRef }: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const proxyInnerRef = useRef<HTMLDivElement | null>(null)
  const syncingRef = useRef(false)
  const [overflow, setOverflow] = useState<{ visible: boolean; scrollWidth: number; clientWidth: number }>({
    visible: false,
    scrollWidth: 0,
    clientWidth: 0,
  })

  // Observe board dimensions to know whether to show the proxy and how wide its inner element should be.
  useEffect(() => {
    const board = boardRef.current
    if (!board) return

    const measure = () => {
      const scrollWidth = board.scrollWidth
      const clientWidth = board.clientWidth
      setOverflow({
        visible: scrollWidth > clientWidth + 1,
        scrollWidth,
        clientWidth,
      })
    }
    measure()

    const ro = new ResizeObserver(measure)
    ro.observe(board)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [boardRef])

  // Two-way scroll sync with a ref guard to avoid feedback loops.
  useEffect(() => {
    const board = boardRef.current
    const track = trackRef.current
    if (!board || !track) return

    const onBoardScroll = () => {
      if (syncingRef.current) return
      syncingRef.current = true
      track.scrollLeft = board.scrollLeft
      // release on next frame so the corresponding track scroll event we just triggered is ignored
      requestAnimationFrame(() => {
        syncingRef.current = false
      })
    }
    const onTrackScroll = () => {
      if (syncingRef.current) return
      syncingRef.current = true
      board.scrollLeft = track.scrollLeft
      requestAnimationFrame(() => {
        syncingRef.current = false
      })
    }

    board.addEventListener('scroll', onBoardScroll, { passive: true })
    track.addEventListener('scroll', onTrackScroll, { passive: true })
    return () => {
      board.removeEventListener('scroll', onBoardScroll)
      track.removeEventListener('scroll', onTrackScroll)
    }
  }, [boardRef])

  if (!overflow.visible) return null

  return (
    <div
      // Hidden on small screens (board view is suppressed there anyway).
      className="hidden sm:block fixed bottom-0 left-0 right-0 z-40 pointer-events-none"
    >
      <div
        ref={trackRef}
        className="pointer-events-auto mx-auto overflow-x-auto overflow-y-hidden bg-white/85 backdrop-blur border-t border-gray-200 shadow-[0_-1px_2px_rgba(0,0,0,0.04)]"
        style={{ height: 14 }}
      >
        <div
          ref={proxyInnerRef}
          style={{ width: overflow.scrollWidth, height: 1 }}
        />
      </div>
    </div>
  )
}
```

Notes:
- `pointer-events-none` on the outer wrapper + `pointer-events-auto` on the track means the track captures scroll/drag but doesn't block clicks elsewhere on the page.
- `bg-white/85 backdrop-blur` keeps it readable over any page content above.
- `height: 14` matches the browser default scrollbar thickness on most platforms (the user-facing affordance).
- Inner spacer width = the board's `scrollWidth` so the native scroll thumb is sized correctly.

- [ ] **Step 2: Verify build**

```
npm run build
```

Expected: build passes.

- [ ] **Step 3: Commit**

```
git add src/components/loans/board-scrollbar.tsx
git commit -m "feat: add viewport-bottom scrollbar for board view"
```

---

## Task 4: Refactor BoardView to use new components

**Files:**
- Modify: `src/components/loan-list-sorted.tsx` (BoardView function, lines 254-305)

This is the integration step. After this task the board view changes visibly.

- [ ] **Step 1: Update imports at the top of `loan-list-sorted.tsx`**

In `src/components/loan-list-sorted.tsx`, near the top of the file with the other imports, **add** these two lines:

```ts
import { BoardLoanCard } from '@/components/loans/board-loan-card'
import { BoardScrollbar } from '@/components/loans/board-scrollbar'
import { formatCompactCurrency } from '@/lib/format'
```

And **remove** the unused `Link` import if BoardView was the only consumer (search the file - if `Link` appears elsewhere, leave the import). Likewise `Card` and `CardContent` were used only by BoardView's inline card; check usage and remove if no other consumer remains.

Also add `useRef` to the existing `react` import:

```ts
import { useMemo, useRef, useState } from 'react'
```

- [ ] **Step 2: Update the BoardView signature to accept outstandingMap and outstandingFor**

Find the BoardView call site (in the JSX of `LoanListSorted`, search for `<BoardView`). Update it to pass `outstandingMap`:

```tsx
<BoardView loans={pipelineLoans} linkPrefix={linkPrefix} outstandingMap={outstandingMap} />
```

(`pipelineLoans` may currently be named `viewLoans` or similar - use whatever variable BoardView already receives as `loans`. Do not rename it.)

- [ ] **Step 3: Replace the BoardView function body**

Replace the entire `function BoardView(...)` definition (currently lines 254-305) with this implementation:

```tsx
function BoardView({
  loans,
  linkPrefix,
  outstandingMap,
}: {
  loans: LoanWithBorrower[]
  linkPrefix: string
  outstandingMap: Record<string, OutstandingCounts>
}) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  const columns = BOARD_STAGES.map(stage => {
    const stageLoans = loans.filter(l => l.pipeline_stage === stage)
    const total = stageLoans.reduce((sum, l) => sum + (l.loan_amount ?? 0), 0)
    return { stage, loans: stageLoans, total }
  })

  return (
    <>
      <div className="pb-4">
        <div
          ref={scrollContainerRef}
          className="flex gap-3 overflow-x-auto pb-2 snap-x -mx-2 px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {columns.map(({ stage, loans: stageLoans, total }) => (
            <div key={stage} className="w-48 shrink-0 snap-start">
              <div className="flex items-center justify-between mb-2 px-1 gap-2">
                <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide truncate">
                  {formatStage(stage)}
                </h3>
                <span className="text-[10px] text-gray-500 shrink-0 whitespace-nowrap">
                  {stageLoans.length} · {formatCompactCurrency(total)}
                </span>
              </div>
              <div className="space-y-1.5">
                {stageLoans.map(loan => (
                  <BoardLoanCard
                    key={loan.id}
                    loan={loan}
                    outstanding={outstandingMap[loan.id] ?? ZERO_COUNTS}
                    linkPrefix={linkPrefix}
                  />
                ))}
                {stageLoans.length === 0 && (
                  <div className="border-2 border-dashed border-gray-200 rounded-md h-12 flex items-center justify-center">
                    <p className="text-[11px] text-gray-400">Empty</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <BoardScrollbar boardRef={scrollContainerRef} />
    </>
  )
}
```

Key changes from before:
- Columns are `w-48` (192px) down from `w-70` (280px).
- `gap-3` (12px) down from `gap-4` (16px).
- Header shows `count · $total` instead of just count.
- Cards are `BoardLoanCard` instead of inline `<Card>`.
- Native scrollbar hidden via `[scrollbar-width:none] [&::-webkit-scrollbar]:hidden`.
- BoardScrollbar rendered as a sibling, sharing the container ref.
- The empty-state placeholder is smaller (`h-12`) to match the new card height.

- [ ] **Step 4: Verify build**

```
npm run build
```

Expected: build passes. Resolve any TypeScript errors before moving on - the most likely failure is `useRef` not imported, `outstandingMap` prop missing, or an unused import warning.

- [ ] **Step 5: Commit**

```
git add src/components/loan-list-sorted.tsx
git commit -m "refactor: compact board cards + sticky scrollbar in BoardView"
```

---

## Task 5: Mobile guard for the Board view toggle

**Files:**
- Modify: `src/components/loans/loan-list-toolbar.tsx` (lines 217-226)

- [ ] **Step 1: Hide the Board toggle button below `sm`**

In `src/components/loans/loan-list-toolbar.tsx`, find the Board button (around lines 217-225) and add `hidden sm:flex` to its className. Replace:

```tsx
          <button
            type="button"
            onClick={() => onViewChange('board')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm border-l border-gray-300 transition-colors ${
              state.view === 'board' ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" /> Board
          </button>
```

With:

```tsx
          <button
            type="button"
            onClick={() => onViewChange('board')}
            className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-sm border-l border-gray-300 transition-colors ${
              state.view === 'board' ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" /> Board
          </button>
```

- [ ] **Step 2: Force board -> list when on a small screen**

The above hides the button but does not fall back if a user had `view === 'board'` persisted in URL/storage and shrinks their window or visits on mobile. Add a small effect in `LoanListSorted`.

In `src/components/loan-list-sorted.tsx`, near the top of the `LoanListSorted` function body (right after `const { state, patch, ... } = useLoanListView()`), add:

```tsx
  // Force list view on screens narrower than `sm`. Board view is suppressed there.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 639.98px)')
    const sync = () => {
      if (mq.matches && state.view === 'board') {
        patch({ view: 'list' })
      }
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [state.view, patch])
```

Add `useEffect` to the React import if not already imported:

```ts
import { useEffect, useMemo, useRef, useState } from 'react'
```

- [ ] **Step 3: Verify build**

```
npm run build
```

Expected: build passes.

- [ ] **Step 4: Commit**

```
git add src/components/loans/loan-list-toolbar.tsx src/components/loan-list-sorted.tsx
git commit -m "feat: hide Board view on screens below sm breakpoint"
```

---

## Task 6: Manual verification

**Files:** none modified - this is a verification task.

This project has no automated tests for UI. Verification is a manual browser walkthrough using the dev server.

- [ ] **Step 1: Start dev server**

```
npm run dev
```

The user's memory notes the worktree dev server runs on port 3100; if this is the main checkout, default port is 3000. Use whichever the terminal output reports.

- [ ] **Step 2: Walk through the loan-officer board view**

Open `http://localhost:<port>/loan-officer/loans` (or whichever role you are signed in as). Verify:

1. Click "Board" in the view toggle.
2. On a desktop window (>= 1440px wide), all 7 columns are visible without horizontal scroll.
3. Cards are visibly shorter (~52px) than before; columns are visibly narrower (~192px).
4. Column headers show `STAGE NAME  count · $TOTAL` (e.g., `UNDERWRITING  7 · $1.4M`).
5. Loans with outstanding items show colored left stripes (red = you, amber = borrower/team, green = clear) matching the same loans in list view.
6. Hovering a card lifts shadow + darkens border (parity with LoanCard hover).
7. Clicking a card navigates to the loan detail page.

- [ ] **Step 3: Verify sticky scrollbar**

1. Resize the browser window to ~1100px wide so the board overflows horizontally.
2. Confirm a thin gray scrollbar appears pinned to the **viewport bottom** (not below the cards).
3. Scroll the page vertically. The scrollbar should stay at the bottom of the viewport regardless.
4. Drag the scrollbar - columns should scroll horizontally in sync.
5. Click and horizontally-scroll a column area - the bottom scrollbar should move in sync.
6. Widen the window back so all columns fit - the bottom scrollbar should disappear.

- [ ] **Step 4: Verify mobile fallback**

1. Open DevTools, switch to a mobile device emulation (e.g., iPhone 14, 390px wide).
2. Reload the page. The "Board" toggle button should not be visible; only "List" appears.
3. If you had `?view=board` in the URL, the view should auto-fall-back to list.

- [ ] **Step 5: Smoke-check another role**

Open `http://localhost:<port>/admin/loans` (admin variant). Confirm Board view renders the same with admin's `linkPrefix`. Click a card to confirm the link goes to `/admin/loans/<id>`, not the loan-officer prefix.

- [ ] **Step 6: Final build**

```
npm run build
```

Must pass cleanly with no new ESLint or TypeScript errors.

- [ ] **Step 7: Push branch**

```
git push -u origin feat/loans-board-compact
```

Do not open the PR from this task - the next workflow phase (finishing-a-development-branch) handles that.

---

## Acceptance checklist

Confirm each before declaring done:

- [ ] At 1440px+, all 7 pipeline columns visible without horizontal scroll
- [ ] When horizontal scroll is needed, scrollbar is always visible at viewport bottom regardless of page scroll
- [ ] Card accent color matches list view's accent for every loan (red/amber/green/on-hold/cancelled)
- [ ] Outstanding-on-you loans show "You N" red chip
- [ ] Column header shows count and compact total dollar volume
- [ ] On < 640px screens, Board toggle is hidden and any `view=board` state falls back to list
- [ ] `npm run build` passes
- [ ] Manual verification across at least loan-officer and admin role pages

---

## Risks and gotchas (for the engineer)

- **Scroll feedback loops:** the ref-based `syncingRef` guard is load-bearing. Replacing it with a `useState` boolean would lag by a render and produce jitter. If you "improve" the scroll sync to use state, the bug will be visible immediately.
- **`ResizeObserver` in tests:** none exist here, so this is moot, but for the record - if tests ever get added, `ResizeObserver` must be polyfilled in jsdom.
- **`scrollbar-width: none` Tailwind v4 syntax:** the bracket-arbitrary class `[scrollbar-width:none]` requires Tailwind v4. The project uses v4 per CLAUDE.md.
- **Other LoanCard duplicates:** there are now three places that compute outstanding-based accent colors (LoanCard, BoardLoanCard, plus the small `getRowAccent` if it exists elsewhere). This duplication is intentional for this PR. A follow-up extraction to `src/lib/loans/accent.ts` could DRY it up, but only if a third consumer appears.
- **Pipedrive sync untouched:** loan data flow is unchanged. If a stage badge color looks "wrong," check `pipeline_stage` raw value in the DB, not this code.
