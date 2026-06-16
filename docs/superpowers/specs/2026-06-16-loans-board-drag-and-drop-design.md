# Loans Board: Drag-and-Drop Stage Change

**Date:** 2026-06-16
**Author:** apalmiotto (with Claude)
**Status:** Approved for planning

## Problem

The board view (`/loans` -> Board) groups loans into 6 pipeline-stage columns but is read-only. To move a loan to the next stage, users have to open the loan and use the dropdown (or use the list view's editable-stage selector). For a pipeline visualization, the natural action is to drag the card into the next column.

The mutation surface to do this already exists - `PATCH /api/loans/stage` handles role gating, Pipedrive write, Airtable sync, and `loan_events` logging. This work is purely a frontend layer on top of that endpoint.

## Scope

In scope:
- Drag-and-drop UX on the board cards in `BoardView` (inside `src/components/loan-list-sorted.tsx`)
- Optimistic UI with snap-back on failure
- Visual affordance during drag (target column highlight)
- View-As impersonation lock (mirrors list-view dropdown)
- Keyboard support (free from `@dnd-kit`'s default sensors)

Out of scope:
- Reordering within a column (sort is owned by the toolbar)
- A `Closed` column on the board (Closed is excluded from `BOARD_STAGES`; closing still happens via list-view dropdown or loan-detail page)
- Restricting drag based on the user's loan assignment (would require client-side role plumbing; backend already rejects unauthorized drags with a 403, snap-back covers it for now)
- Bulk-select / multi-card drag
- Custom transition rules (any-to-any allowed; matches list view)

## Design

### Library

`@dnd-kit/core` (one dependency, ~30KB gz). It's the modern, accessible, touch-aware React DnD library used by Linear, Notion, and dozens of others. The package ships keyboard, mouse, and touch sensors out of the box, so accessibility is mostly free.

Not using `@dnd-kit/sortable` - we don't need within-column ordering. The lighter `@dnd-kit/core` `useDraggable` + `useDroppable` primitives are sufficient.

### State model

The current `BoardView` derives each column's loans from `loans.filter(l => l.pipeline_stage === stage)`. To support optimistic moves, we introduce a local override map:

```ts
const [stageOverrides, setStageOverrides] = useState<Record<string, PipelineStage>>({})

const effectiveStage = (loan: LoanWithBorrower) =>
  stageOverrides[loan.id] ?? loan.pipeline_stage
```

Columns are then computed from `effectiveStage(loan)` instead of `loan.pipeline_stage`. When the server confirms, `router.refresh()` re-fetches the props and we can clear the override for that loan. When it fails, we delete the override and the loan snaps back to its server-truth stage.

This approach means the optimistic state is purely additive - we never mutate the source `loans` array, just overlay it.

### Drag handler

`onDragEnd` from the `DndContext` gives us `{ active, over }`. `active.id` is the loan id, `over.id` is the destination stage. Logic:

```ts
async function onDragEnd({ active, over }) {
  if (!over || isImpersonating) return
  const loanId = String(active.id)
  const newStage = over.id as PipelineStage
  const loan = loans.find(l => l.id === loanId)
  if (!loan) return
  const previous = effectiveStage(loan)
  if (previous === newStage) return  // no-op

  setStageOverrides(prev => ({ ...prev, [loanId]: newStage }))
  setLastError(null)

  try {
    const res = await fetch('/api/loans/stage', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loanId, stage: newStage }),
    })
    const data = await res.json().catch(() => ({}))
    if (!data.success) throw new Error(data.error ?? 'Could not change stage')
    router.refresh()
    // override stays until refresh resolves; harmless either way
  } catch (err) {
    setStageOverrides(prev => {
      const { [loanId]: _, ...rest } = prev
      return rest
    })
    setLastError({ loanId, message: (err as Error).message })
    window.setTimeout(() => setLastError(null), 4000)
  }
}
```

### Visual affordance

- Dragging card: gets a slight `scale-105` + drop shadow, cursor `grabbing`
- Source column: dims slightly (existing card grays out, gap remains)
- Destination column on hover (`isOver` from `useDroppable`): subtle blue ring on the column header + drop-target hint background
- Inactive board cards stay as-is; cursor is `grab` on hover
- Error flash: when `lastError.loanId === loan.id`, the card that just snapped back gets a brief `ring-2 ring-red-400` for the 4s the error is visible
- Error message: small red text below the column header of the column the loan tried to move TO, shows for 4s then clears

### View-As lock

Get `isImpersonating` from `useImpersonation()`. Pass it through to:
- `DndContext`'s `sensors` -> use a `PointerSensor` with `activationConstraint` only when `!isImpersonating`; otherwise no sensors registered so drag is impossible
- The card's `cursor` class -> stays `cursor-default` when impersonating

Simpler implementation: gate at the `useDraggable` level inside each card via the `disabled` option.

### Backend contract

No backend changes. Existing endpoint:
- `PATCH /api/loans/stage`
- Body: `{ loanId: string, stage: PipelineStage }`
- Returns: `{ success: true }` or `{ success: false, error: string }`
- Handles role gating (admin OR loan-assigned LO/LP/UW), Pipedrive write, Airtable sync, `loan_events` insert

Stage-protected events (the Pipedrive forward-stage downgrade logic in `effective-stage.ts`) don't apply here because we're explicitly moving FROM a portal user TO a stage, not reconciling a sync event.

## Acceptance criteria

1. Drag a card from column A to column B on `/loan-officer/loans?view=board` -> the card appears in column B immediately
2. Refresh the page -> the card is still in column B (server confirmed)
3. Simulate a server failure (e.g., set `loanId` to an invalid one in DevTools) -> the card snaps back to column A and an inline error appears for 4s
4. While View-As is active, attempt to drag a card -> the cursor stays default; no drag occurs
5. Keyboard-driven drag works (Tab to card, Space to pick up, Arrow to navigate, Space to drop) - this is free from `@dnd-kit`
6. `loan_events` shows a `stage_changed` row with the editor's name after a successful drag
7. The existing list-view stage dropdown continues to work unchanged
8. `npm run build` passes

## Files touched

- `package.json` - add `@dnd-kit/core`
- `src/components/loan-list-sorted.tsx` - wrap BoardView in DndContext, swap inline card markup for draggable cards, columns become drop targets, add state and handler

No new files. The drag logic is small enough that extracting a `BoardCard` helper isn't justified yet.

## Risks / verification notes

- **Pipedrive latency:** the endpoint synchronously writes to Pipedrive (line 83 of the route). If Pipedrive is slow (3-5s on a bad day), `router.refresh()` won't fire until then - but the card is already optimistically in the new column, so the user doesn't notice. Failure mode is fine.
- **Loan-assignment 403:** a non-admin LO trying to drag a loan they're not assigned to will get a 403 and snap-back. The error message from the endpoint ("Not authorized for this loan" or similar) will appear in the inline error. Not great UX, but it's the same failure-feel as the existing list-view dropdown when the same user picks a stage. Follow-up to gate the drag-affordance client-side would require shipping role+assignment per-loan to the client.
- **Concurrent drags:** if a user starts dragging Card A, then before it confirms drags Card B - both run concurrently. Each has its own override entry. No interaction between them. Fine.
- **Stale-state if user reloads mid-flight:** the optimistic override only lives in component state, so a hard reload while a fetch is in-flight would clear the override and the server might still complete. Acceptable - on next refresh the card shows the actual server stage.

## Open questions

None at design time.
