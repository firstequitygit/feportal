# Loans Board Drag-and-Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add drag-and-drop in the board view so loan cards can be moved between pipeline-stage columns, calling the existing `PATCH /api/loans/stage` endpoint optimistically.

**Architecture:** Wrap `BoardView` in a `@dnd-kit/core` `DndContext`. Each card uses `useDraggable`, each column uses `useDroppable`. A local `stageOverrides` map provides instant optimistic updates; failures snap the card back and surface an inline error.

**Tech Stack:** `@dnd-kit/core` (new dep), React 19, Next.js 16 App Router, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-06-16-loans-board-drag-and-drop-design.md`

**Note for the engineer:** This project has **no automated test suite**. `npm run build` is the correctness gate. Verification at the end is manual via Playwright + the dev server. Run the build between tasks if a task adds non-trivial code; otherwise build once at the end of Task 4.

**Branch:** Work on `feat/loans-board-dnd` off `main`. Squash-merge repo.

---

## File structure

- `package.json` (modify) - add `@dnd-kit/core` to dependencies
- `src/components/loan-list-sorted.tsx` (modify) - wrap BoardView in DndContext, make cards draggable and columns droppable, add state + handler

No new files. The DnD logic is small enough that extracting a separate component would be premature.

---

## Task 1: Install @dnd-kit/core

**Files:**
- Modify: `package.json` + `package-lock.json`

- [ ] **Step 1: Install the package**

From the `feportal/` directory:

```
npm install @dnd-kit/core
```

- [ ] **Step 2: Verify the install**

```
npm ls @dnd-kit/core
```

Expected: a single entry showing the installed version (likely `@dnd-kit/core@6.x`). No peer-dep warnings.

- [ ] **Step 3: Commit**

```
git add package.json package-lock.json
git commit -m "chore: add @dnd-kit/core for board drag-and-drop"
```

---

## Task 2: Add imports, state, and drag handler to LoanListSorted

**Files:**
- Modify: `src/components/loan-list-sorted.tsx`

This task adds everything needed for the drag mechanic but does not yet wire it into JSX. After this task the file compiles but UI is unchanged. Task 3 wires it up.

- [ ] **Step 1: Update React imports**

Find the existing React import at the top of `src/components/loan-list-sorted.tsx`:

```ts
import { useMemo, useState } from 'react'
```

Replace with:

```ts
import { useCallback, useMemo, useState } from 'react'
```

- [ ] **Step 2: Add new module imports**

Just below the existing imports (after the `import type { LatestStaffNotes }` line near the top), add:

```ts
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useRouter } from 'next/navigation'
import { useImpersonation } from '@/components/impersonation-provider'
import type { PipelineStage } from '@/lib/types'
```

The `useRouter` and `useImpersonation` imports might already exist elsewhere in the file - if so, skip the duplicate. The `PipelineStage` type is imported alongside `Loan` and `OutstandingCounts` higher up; merge it into that existing import if cleaner.

- [ ] **Step 3: Add the drag state at the top of `LoanListSorted`**

Find the `LoanListSorted` function body. Right after the `useLoanListView()` hook call, add:

```tsx
  const router = useRouter()
  const { isImpersonating } = useImpersonation()

  const [stageOverrides, setStageOverrides] = useState<Record<string, PipelineStage>>({})
  const [lastError, setLastError] = useState<{ loanId: string; stage: PipelineStage; message: string } | null>(null)

  const effectiveStage = useCallback(
    (loanId: string, serverStage: PipelineStage | null): PipelineStage | null =>
      stageOverrides[loanId] ?? serverStage,
    [stageOverrides],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  )

  const onDragEnd = useCallback(async (event: DragEndEvent) => {
    if (isImpersonating) return
    const { active, over } = event
    if (!over) return
    const loanId = String(active.id)
    const newStage = String(over.id) as PipelineStage
    const loan = allLoans.find(l => l.id === loanId)
    if (!loan) return
    const currentStage = stageOverrides[loanId] ?? loan.pipeline_stage
    if (currentStage === newStage) return

    setStageOverrides(prev => ({ ...prev, [loanId]: newStage }))
    setLastError(null)

    try {
      const res = await fetch('/api/loans/stage', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId, stage: newStage }),
      })
      const data = await res.json().catch(() => ({}))
      if (!data?.success) {
        throw new Error(data?.error ?? 'Could not change stage')
      }
      router.refresh()
    } catch (err) {
      setStageOverrides(prev => {
        const next = { ...prev }
        delete next[loanId]
        return next
      })
      setLastError({ loanId, stage: newStage, message: (err as Error).message })
      window.setTimeout(() => setLastError(null), 4000)
    }
  }, [allLoans, isImpersonating, router, stageOverrides])
```

Note: `allLoans` is already defined further down in `LoanListSorted` via `useMemo`. The `onDragEnd` callback depends on it; React will warn if `allLoans` is declared AFTER `onDragEnd`. If that happens at build time, move the `allLoans` useMemo above this block. (Look at line ~80 of the existing file to confirm the order.)

- [ ] **Step 4: Verify build**

```
npm run build
```

Expected: build passes. New imports and state should be inert. If TS complains that `effectiveStage` is unused, that's fine - Task 3 wires it up. If ESLint flags it, add a single `// eslint-disable-next-line @typescript-eslint/no-unused-vars` above the `effectiveStage` line as a temporary marker; remove it in Task 3.

- [ ] **Step 5: Commit**

```
git add src/components/loan-list-sorted.tsx
git commit -m "feat: add drag-state + handler scaffolding for board DnD"
```

---

## Task 3: Wire drag-and-drop into the BoardView JSX

**Files:**
- Modify: `src/components/loan-list-sorted.tsx` (BoardView function body + BoardView call site)

- [ ] **Step 1: Pass new props from `LoanListSorted` to `BoardView`**

Find the `<BoardView ... />` call (currently passes `loans`, `linkPrefix`, `outstandingMap`, `roleActivityMap`). Add the DnD props:

```tsx
      {state.view === 'board' && (
        <BoardView
          loans={groups.flatMap(g => g.loans)}
          linkPrefix={linkPrefix}
          outstandingMap={outstandingMap}
          roleActivityMap={roleActivityMap}
          effectiveStage={effectiveStage}
          stageOverrides={stageOverrides}
          lastError={lastError}
          sensors={sensors}
          onDragEnd={onDragEnd}
          dragDisabled={isImpersonating}
        />
      )}
```

- [ ] **Step 2: Update the `BoardView` function signature**

Find the existing `function BoardView({ loans, linkPrefix, outstandingMap, roleActivityMap }: { ... })` and update both the destructured params and the type block:

```tsx
function BoardView({
  loans,
  linkPrefix,
  outstandingMap,
  roleActivityMap,
  effectiveStage,
  stageOverrides,
  lastError,
  sensors,
  onDragEnd,
  dragDisabled,
}: {
  loans: LoanWithBorrower[]
  linkPrefix: string
  outstandingMap: Record<string, OutstandingCounts>
  roleActivityMap?: Record<string, RoleActivity>
  effectiveStage: (loanId: string, serverStage: PipelineStage | null) => PipelineStage | null
  stageOverrides: Record<string, PipelineStage>
  lastError: { loanId: string; stage: PipelineStage; message: string } | null
  sensors: ReturnType<typeof useSensors>
  onDragEnd: (event: DragEndEvent) => void
  dragDisabled: boolean
}) {
```

- [ ] **Step 3: Use `effectiveStage` for column filtering**

In `BoardView`, the existing column-building line is:

```ts
const columns = BOARD_STAGES.map(stage => {
  const stageLoans = loans.filter(l => l.pipeline_stage === stage)
  const total = stageLoans.reduce((sum, l) => sum + (l.loan_amount ?? 0), 0)
  return { stage, loans: stageLoans, total }
})
```

Change it to use `effectiveStage`:

```ts
const columns = BOARD_STAGES.map(stage => {
  const stageLoans = loans.filter(l => effectiveStage(l.id, l.pipeline_stage) === stage)
  const total = stageLoans.reduce((sum, l) => sum + (l.loan_amount ?? 0), 0)
  return { stage, loans: stageLoans, total }
})
```

- [ ] **Step 4: Extract the card into a draggable sub-component**

Inside the same file, just above the `function BoardView(` line, add a new internal component `BoardDraggableCard` that wraps the existing card markup with `useDraggable`:

```tsx
function BoardDraggableCard({
  loan,
  outstanding,
  linkPrefix,
  roleActivity,
  errored,
  disabled,
}: {
  loan: LoanWithBorrower
  outstanding: OutstandingCounts
  linkPrefix: string
  roleActivity?: RoleActivity
  errored: boolean
  disabled: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: loan.id,
    disabled,
  })

  const accent = boardAccentClass(loan, outstanding)
  const chip = boardStatusChip(loan, outstanding)
  const isDimmed = loan.loan_status === 'cancelled' || loan.pipeline_stage === 'Closed'

  // While dragging, position via transform so it follows the cursor without
  // affecting the surrounding flex layout.
  const style: React.CSSProperties = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: 50,
      }
    : {}

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Link
        href={`${linkPrefix}/loans/${loan.id}`}
        onClick={e => { if (isDragging) e.preventDefault() }}
        className={`block rounded-md border border-gray-200 border-l-4 ${accent} bg-white px-2 py-1.5 transition-all duration-150 hover:shadow-sm hover:border-gray-300 ${
          isDimmed ? 'opacity-70' : ''
        } ${loan.loan_status === 'on_hold' ? 'bg-amber-50/40' : ''} ${
          isDragging ? 'scale-[1.02] shadow-lg cursor-grabbing' : disabled ? 'cursor-default' : 'cursor-grab'
        } ${errored ? 'ring-2 ring-red-400' : ''}`}
      >
        <div className="flex items-baseline justify-between gap-1.5">
          <p className="text-[11px] font-semibold text-gray-900 leading-tight truncate min-w-0 flex-1">
            {formatLoanName({
              borrowerName: loan.borrowers?.full_name,
              propertyAddress: loan.property_address,
              loanNumber: loan.loan_number,
            })}
          </p>
          <p className="text-[11px] font-semibold text-gray-900 whitespace-nowrap">
            {formatCompactCurrency(loan.loan_amount)}
          </p>
        </div>
        <div className="flex items-center justify-between gap-1 mt-0.5">
          <p className="text-[10px] text-gray-500 truncate min-w-0 flex-1">
            {loan.loan_type ?? '—'}
          </p>
          <div className="flex items-center gap-1 shrink-0">
            {roleActivity && <RoleActivityStamps activity={roleActivity} />}
            {chip && (
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${chip.className}`}>
                {chip.text}
              </span>
            )}
          </div>
        </div>
      </Link>
    </div>
  )
}
```

Notes:
- The `onClick` guard (`if (isDragging) e.preventDefault()`) stops a click-through to the loan detail page when the user just dropped a card. Without it, a quick drag fires both `dragEnd` and `click`, and you'd navigate away mid-drop.
- The wrapper `<div>` is the drag handle (gets `setNodeRef` + `listeners`). The inner `<Link>` is what the user clicks to navigate.
- `formatCompactCurrency`, `boardAccentClass`, `boardStatusChip` are existing helpers already in this file (from the recent compact-board work).

- [ ] **Step 5: Extract the column into a droppable sub-component**

Just above `BoardDraggableCard`, add a `BoardDroppableColumn` component:

```tsx
function BoardDroppableColumn({
  stage,
  children,
  errorMessage,
}: {
  stage: PipelineStage
  children: React.ReactNode
  errorMessage: string | null
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage })
  return (
    <div
      ref={setNodeRef}
      className={`w-48 shrink-0 snap-start rounded-md transition-colors ${
        isOver ? 'bg-blue-50 ring-1 ring-blue-200' : ''
      }`}
    >
      {children}
      {errorMessage && (
        <p className="mt-1 px-1 text-[10px] text-red-600 truncate" title={errorMessage}>
          {errorMessage}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Replace BoardView's column rendering**

Inside `BoardView`'s return, find the existing column map (`columns.map(({ stage, loans: stageLoans, total }) => (...))`) and rewrite it to use the two new components and wrap the whole board in a `DndContext`. Replace the entire `return (...)` block:

```tsx
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="pb-4">
        <div className="flex gap-2 overflow-x-auto pb-2 snap-x -mx-2 px-2">
          {columns.map(({ stage, loans: stageLoans, total }) => (
            <BoardDroppableColumn
              key={stage}
              stage={stage}
              errorMessage={lastError && lastError.stage === stage ? lastError.message : null}
            >
              <div className="flex items-center justify-between mb-1.5 px-1 gap-2">
                <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide truncate">
                  {formatStage(stage)}
                </h3>
                <span className="text-[10px] text-gray-500 shrink-0 whitespace-nowrap">
                  {stageLoans.length}{total > 0 ? ` · ${formatCompactCurrency(total)}` : ''}
                </span>
              </div>
              <div className="space-y-1">
                {stageLoans.map(loan => (
                  <BoardDraggableCard
                    key={loan.id}
                    loan={loan}
                    outstanding={outstandingMap[loan.id] ?? ZERO_COUNTS}
                    linkPrefix={linkPrefix}
                    roleActivity={roleActivityMap ? roleActivityMap[loan.id] ?? { lp: null, uw: null } : undefined}
                    errored={lastError?.loanId === loan.id}
                    disabled={dragDisabled}
                  />
                ))}
                {stageLoans.length === 0 && (
                  <div className="border border-dashed border-gray-200 rounded-md h-10 flex items-center justify-center">
                    <p className="text-[10px] text-gray-400">Empty</p>
                  </div>
                )}
              </div>
            </BoardDroppableColumn>
          ))}
        </div>
      </div>
    </DndContext>
  )
```

The column-level `w-48 shrink-0 snap-start` styling moved into `BoardDroppableColumn`.

- [ ] **Step 7: Verify build**

```
npm run build
```

Expected: build passes. Resolve any TypeScript errors before moving on. Most likely failure points:
- `effectiveStage` was unused in Task 2 - now it's used; remove the `eslint-disable` marker if you added one
- Type mismatch on `over.id as PipelineStage` - the `id` from `over` is `UniqueIdentifier` (string | number); the cast is fine because we set it from our `PipelineStage` strings
- React might warn about `key` prop placement - if so, move keys onto `<BoardDroppableColumn>` (already done above)

- [ ] **Step 8: Commit**

```
git add src/components/loan-list-sorted.tsx
git commit -m "feat: drag-and-drop loan stage changes in board view"
```

---

## Task 4: Manual verification

**Files:** none modified.

- [ ] **Step 1: Start dev server**

```
npm run dev -- -p 3100
```

Wait for "Ready in …" output.

- [ ] **Step 2: Happy path**

Navigate to `http://localhost:3100/loan-officer/loans?view=board` (use your usual logged-in role).

1. Hover a card - cursor should be `grab`.
2. Click-and-hold (>5px movement) - card lifts with a slight scale + shadow.
3. Drag toward another column - destination column highlights with a soft blue ring.
4. Drop - card lands in the new column immediately.
5. After ~1-2s the page refreshes (Pipedrive write completes), and the loan stays in the new column.

- [ ] **Step 3: Failure path**

In DevTools, set a network throttle to "Offline" temporarily, drag a card to a new column. Expected:
- Card moves optimistically
- After the fetch times out, it snaps back to the original column
- An inline red message appears below the destination column header for 4s
- The original-column card briefly shows a red ring

Turn the network back on and try again - should work.

- [ ] **Step 4: View-As lock**

If admin: enter View-As as a non-admin role. Navigate to the board. Hover a card - cursor should be the default `pointer` from the `<Link>`, not `grab`. Click-and-drag should not move the card at all.

- [ ] **Step 5: Keyboard drag**

Tab to a board card. Press Space - the card should "lift" (focus state). Use arrow keys to navigate to another column. Space again to drop. Result should match a mouse drag.

- [ ] **Step 6: Backend confirmation**

Open the loan detail page for a card you just dragged. The Activity / Loan Events tab should show a new `stage_changed` event with the move description.

- [ ] **Step 7: Smoke-check the list view**

Toggle back to List. Confirm the existing stage dropdown still works - drag the same loan via the dropdown, verify it moves correctly.

- [ ] **Step 8: Final build**

```
npm run build
```

Must pass cleanly.

- [ ] **Step 9: Push the branch**

```
git push -u origin feat/loans-board-dnd
```

Do not open the PR from this task - the workflow's finishing-a-development-branch phase handles that.

---

## Acceptance checklist (mirrors the spec)

- [ ] Drag a card from column A to column B → card appears in column B immediately
- [ ] Refresh → still in column B
- [ ] Forced failure → card snaps back, inline error appears for 4s, cleared after
- [ ] View-As → no drag possible
- [ ] Keyboard-driven drag works end-to-end
- [ ] `loan_events` shows a new `stage_changed` row
- [ ] List-view dropdown still works
- [ ] `npm run build` passes

---

## Risks / gotchas (for the engineer)

- **`PointerSensor` activation distance:** set to 5px so a click on the card opens the loan detail page (existing behavior); only a deliberate drag activates DnD. Don't lower this below ~3px or accidental drags happen.
- **`onClick` preventDefault during drag:** without it, the `<Link>` fires on mouseup and you navigate away mid-drop. Test by dropping a card and confirming the loan-detail page does NOT load.
- **DndContext at BoardView level (not LoanListSorted level):** important so the drag is unmounted when the user toggles to List view; otherwise the sensor stays armed for offscreen elements.
- **`effectiveStage` ordering:** the override is cleared by `router.refresh()`, but until the refresh completes, the override and the new server state agree (both point to the new column), so no visual flicker.
- **`@dnd-kit/core` SSR safety:** it's a client-only library. `BoardView` already renders in a `'use client'` file, so we're fine. Don't accidentally import it into a server component.
