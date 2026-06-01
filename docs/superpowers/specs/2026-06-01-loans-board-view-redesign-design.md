# Loans Board View Redesign

**Date:** 2026-06-01
**Author:** apalmiotto (with Claude)
**Status:** Approved for planning

## Problem

The Loans board view (`/loans` -> "Board" toggle) has three issues on a typical desktop:

1. Cards are too tall (~120px each) and columns too wide (`w-70` = 280px), so not all 7 pipeline columns fit on a 1440px screen. The horizontal scrollbar sits below the cards, requiring the user to scroll the page vertically just to find it.
2. List view shows a 4px left accent stripe and outstanding-action badges that immediately communicate which loans need attention; board view shows none of that, so visual scanning is harder.
3. Card content is narrower than list view (just address / borrower / type / amount) - the on-hold and cancelled states are invisible.

## Scope

In scope:
- BoardView in `src/components/loan-list-sorted.tsx` (lines 254-305)
- A new compact card component (extracted, since LoanCard is too heavy and intentionally so for list view)
- A viewport-bottom horizontal scrollbar that proxies the board's scroll position
- Column header upgrade (count + total $ volume)
- Mobile fallback to list view below `sm` breakpoint

Out of scope:
- List view (unchanged)
- Toolbar, sort, filter, group controls (unchanged)
- Drag-to-reorder cards between columns
- Column collapse / swimlanes
- Data fetching, archival logic, role checks - this is a presentation-only refactor

## Design

### 1. Compact board card

A new component `BoardLoanCard` lives next to `LoanCard` in `src/components/loans/`. Two lines, ~52px tall, `p-2 text-xs`:

```
┃ 817 Madison Ave, Scranton PA       $260K
┃ Lilian Germoso · Bridge      🔴 You 2
```

Visual logic mirrors `LoanCard.tsx:30-58` so list-view and board-view colors agree:

- **Left accent stripe (4px)**:
  - `outstanding.you > 0` -> `border-l-red-400`
  - `outstanding.total > 0` and `you === 0` -> `border-l-amber-300`
  - `loan_status === 'on_hold'` -> `border-l-amber-400`
  - `loan_status === 'cancelled'` -> `border-l-red-300`
  - else -> `border-l-green-400`
- **Outstanding chip (right side, line 2)**:
  - `you > 0` -> red chip "You {n}"
  - else if `borrower > 0` -> amber chip "Borrower {n}"
  - else if `team > 0` -> gray chip "Team {n}"
  - else -> no chip
- **Status chip overrides outstanding chip**:
  - `on_hold` -> amber "On Hold"
  - `cancelled` -> red "Cancelled"
- **Stage badge omitted** - the column header already conveys the stage. Removing it is the main density win.
- **Loan amount** formatted compactly: `$260K`, `$2.5M`, `$1.4B`. Helper goes in `src/lib/format.ts` (or wherever `formatCurrency` currently lives) as `formatCompactCurrency`.

Card width: column is `w-48` (192px) down from `w-70` (280px). At `gap-3`, seven columns fit in 7 * 192 + 6 * 12 = 1416px, leaving the toolbar area uncluttered on a 1440px+ monitor.

### 2. Column header upgrade

`loan-list-sorted.tsx:265-272`. Add total dollar volume next to the count:

```
UNDERWRITING  7 · $1.4M
```

Computed inline by summing `loan_amount` across `stageLoans`. Uses the same `formatCompactCurrency` helper. Header stays single-line at smaller font.

### 3. Sticky-bottom horizontal scrollbar

A separate scroll-proxy element pinned to the viewport bottom that drives (and reflects) the board container's `scrollLeft`. Always visible regardless of page scroll position.

Component: `BoardScrollbar` in `src/components/loans/board-scrollbar.tsx` (new).

Behavior:
- Renders a thin `position: fixed; bottom: 0` track ~28px tall, full width of the board area
- Internally contains a wide proxy element matching `boardContainer.scrollWidth`
- On the proxy's `scroll` event -> set `boardContainer.scrollLeft`
- On the board container's `scroll` event -> set `proxy.scrollLeft`
- Use a `useRef` for both elements and a guarded ping-pong to avoid scroll feedback loops (one direction at a time, guarded with a ref flag)
- Hide the scrollbar entirely when `boardContainer.scrollWidth <= boardContainer.clientWidth` (no overflow -> no scroll needed)
- Also hide on mobile (< sm) where the board view itself is suppressed
- The board container's native scrollbar gets `[&::-webkit-scrollbar]:hidden` (and `scrollbar-width: none`) since the proxy is now the user-facing affordance

Wired up from BoardView: capture a `ref` on the existing flex container, pass to `<BoardScrollbar boardRef={...} />` rendered just outside the board section.

### 4. Mobile fallback

Below `sm` (640px), board view is not appropriate - columns become unreadable. Two options:

- **Chosen:** When `viewMode === 'board'` and screen is `< sm`, auto-switch to list view with a one-time toast "Board view requires a larger screen - showing list view." Toggling `Board` again on a small screen re-shows the toast.
- Alternative considered: render board view anyway but with single-column-scroll-snap. Rejected because the existing list view is already the better mobile UX and we shouldn't duplicate effort.

Implementation: in the toolbar/view-toggle component, gate the `'board'` selection on a `useMediaQuery('(min-width: 640px)')` hook (or equivalent matchMedia inline). Server render defaults to list to avoid layout shift.

## Files touched

- `src/components/loan-list-sorted.tsx` - BoardView function (lines 254-305): swap inline card for `BoardLoanCard`, narrower columns, header with $ total, integrate `BoardScrollbar`, hide native scrollbar
- `src/components/loans/board-loan-card.tsx` - **new**: compact card mirroring LoanCard color logic
- `src/components/loans/board-scrollbar.tsx` - **new**: viewport-bottom scroll proxy
- `src/lib/format.ts` (or wherever `formatCurrency` lives) - add `formatCompactCurrency`
- `src/components/loans/loan-list-toolbar.tsx` - mobile gate for board selection (lines around 206-227)

No backend, no API, no schema, no auth changes.

## Acceptance criteria

1. On a 1440px+ display, all 7 pipeline columns are visible at once without horizontal scroll.
2. When horizontal scroll *is* required (narrower viewport), the scrollbar is visible at the viewport bottom regardless of how far down the page the user has scrolled.
3. Board cards display the same left-accent color as the equivalent list-view row for every loan (red / amber / green / on-hold / cancelled).
4. Loans with outstanding-on-you items show a red "You N" chip on the card without opening the loan.
5. Column header reads "STAGE NAME  count · $total" using compact formatting.
6. On a phone-sized screen, attempting to switch to board view falls back to list view with a toast.
7. `npm run build` passes with no new ESLint or TypeScript errors.

## Risks / verification notes

- **Scroll proxy ping-pong:** the proxy <-> container scroll sync must use a ref-based guard, not setState. setState-based guards drop frames and produce jitter. Test by scrolling the proxy thumb rapidly back and forth.
- **`scrollWidth` measurement on resize:** the proxy's inner width must update when the window resizes or the loan list changes (e.g., filter applied). Use a `ResizeObserver` on the board container.
- **No auth-adjacent code touched** -> `playwright-role-gates` is not required for this change. Standard Playwright verification (board renders, cards show right colors, scrollbar follows scroll) is sufficient.
- **Five role pages render the same component:** admin / loan-officer / loan-processor / underwriter all use `LoanListSorted` with different `linkPrefix`. One implementation covers all four. Manual smoke check on at least loan-officer + admin paths.

## Open questions

None at design time. All defaults locked in above.
