# CRM-style Data Grid Refactor — Design

**Status:** Draft, pending user review
**Author:** Anthony Palmiotto
**Date:** 2026-05-21
**Scope:** Replace card-based contact lists with a Pipedrive/HubSpot-style data grid across five admin and loan-officer surfaces.

## Problem

Five contact-list surfaces today render as card layouts with at most one search box:

- `/admin/borrowers` — `AdminContactList`
- `/admin/brokers` — `AdminContactList`
- `/loan-officer/borrowers` — `EditableContactList`
- `/loan-officer/brokers` — `EditableContactList`
- `/loan-officer/vendors` — bespoke three-section card layout

This works for a handful of rows but breaks down as the firm grows: there is no per-column sorting, no per-column filtering, no way to hide columns the user does not care about, and no way to share a filtered view via URL. The user wants a CRM grid like Pipedrive or HubSpot.

## Goals

1. Replace all five surfaces with a single reusable `<DataGrid>` component.
2. Each grid supports: show/hide columns, per-column sort, per-column filter.
3. State (visibility, sort, filters) persists in the URL so views are shareable and survive a refresh.
4. Editable cells use click-to-edit (Airtable/HubSpot pattern), not a pencil-icon side flow.
5. Existing data scoping (admin sees all, LO sees only their loans' contacts) stays exactly as it is.

## Non-goals (deferred to follow-up specs)

- **Vendors as first-class data.** Vendors stay derived from `loan_details` columns for now. A separate spec will introduce a real `vendors` table, backfill from existing strings, and rewrite the apply flow + loan-details editor to pick from existing vendors.
- **Server-side filtering or pagination.** Row counts are small (hundreds, not millions). Client-side is fine for v1; the grid contract will not change when we add server-side later.
- **Multi-column sort.** Single-column sort in v1. The TanStack model handles multi-sort natively, so it's a small follow-up.
- **Bulk row selection and bulk actions.** Out of scope for v1.
- **Saved views.** Views are URL-shareable in v1; named/persisted views are a v2 concept (probably keyed on a new `user_preferences` table).
- **New admin nav entries.** Both `/admin/borrowers` and `/admin/brokers` already exist on `main`. This spec touches only their internals.

## Branch prerequisite

The user's current local branch `feature/loan-application-intake` was cut before the loan-officer Borrowers/Brokers/Vendors routes landed on `main`. Step 0 of the implementation plan is to merge `origin/main` into the feature branch so all five surfaces exist on the working tree. This is a local-only operation; production deploys only when `main` is updated.

## Architecture

### New shared primitive — `src/components/data-grid/`

| File | Responsibility |
|---|---|
| `data-grid.tsx` | Generic `<DataGrid<TRow> columns={...} data={...} storageKey={...} initialVisibility={...} editableEndpoint={...} />`. Built on `@tanstack/react-table`. Composes the smaller pieces below. |
| `editable-cell.tsx` | Click-to-edit input. Types supported: `text`, `email`, `phone`, `select`. Saves via the `editableEndpoint` PATCH; optimistic local update; revert + Sonner toast on error. Read-only cells render plain text. |
| `column-header.tsx` | Header cell with sort toggle and a filter popover. Filter UI is picked by column meta (`text-contains` / `number-range` / `multi-select`). |
| `column-visibility-menu.tsx` | Dropdown to show/hide columns. Default visibility set per surface. |
| `filter-bar.tsx` | Active-filter chip row above the table with × to clear individual filters and "Clear all". |
| `use-grid-url-state.ts` | Reads/writes `?cols=…&sort=…&filter:<col>=…` query params. Uses Next.js `useSearchParams` + `router.replace` to avoid full re-renders. |

### Dependency

New dep: `@tanstack/react-table` (~14kb gzipped, headless). Already-installed shadcn `<Table>` primitives in `src/components/ui/table.tsx` provide the rendering shell.

### Surface wiring

Each route stays a Server Component fetching its data with current scoping rules, then hands a typed row array to a thin client wrapper that wires columns and editable endpoints.

| Route | Row shape | Editable cols | Row click |
|---|---|---|---|
| `/admin/borrowers` | `{ id, full_name, email, phone, created_at, has_auth, loan_count }` where `has_auth = (borrowers.auth_user_id is not null)` | name, email, phone | `/admin/borrowers/[id]` |
| `/admin/brokers` | adds `company_name` | name, company, email, phone | `/admin/brokers/[id]` |
| `/loan-officer/borrowers` | scoped to LO's loans; adds `last_loan_activity` | name, email, phone | `/loan-officer/loans/[id]` — the loan with the largest `loans.updated_at` among loans they're on |
| `/loan-officer/brokers` | scoped + `company_name` | name, company, email, phone | same |
| `/loan-officer/vendors` | aggregated `{ name, type, emails, phones, loan_count, loan_ids }` from `loan_details` | none (derived data; edits land in v2) | vendor's loans list inline |

### New detail routes (admin only)

- `src/app/admin/borrowers/[id]/page.tsx` — full record + linked loans table.
- `src/app/admin/brokers/[id]/page.tsx` — same.

LO surfaces navigate into the loan flow rather than a contact detail page, matching how loan officers actually work.

### Vendors: unified grid with `Type` column

The current `aggregate()` function in `src/app/loan-officer/vendors/page.tsx` is generalized to return a flat list across all three types, with `type: 'title' | 'insurance' | 'appraisal'` per row.

Columns: **Name**, **Type** (chip), **Email(s)**, **Phone(s)**, **Loans (count)**.

The Type column uses a multi-select chip filter (Title × | Insurance × | Appraisal ×), all selected by default. Emails and phones display as comma-joined Sets and filter by `contains`.

### URL state schema

| Param | Form | Example |
|---|---|---|
| `cols` | comma-joined visible column ids | `?cols=name,email,phone,loans` |
| `sort` | `<col>:<asc|desc>` | `?sort=loan_count:desc` |
| `filter:<col>` | contains-string for text, `min..max` for numbers, comma-joined for multi-select | `?filter:email=@gmail.com` / `?filter:loans=2..` / `?filter:type=title,insurance` |

Missing params fall back to the surface's defaults.

### Click-to-edit interaction model

- Editable cells enter edit mode on a single click; text is selected for easy replace.
- Enter or blur commits; Escape cancels.
- Optimistic update on commit; on PATCH failure, revert and toast.
- A chevron icon at the far right of each row navigates to the detail/loan target. This is the unambiguous "open" affordance so the entire row body can remain edit-on-click.
- Read-only cells (loan count, created_at, account status, vendor cells in v1) do not enter edit mode on click.

### Auth & data flow

- Page-level role gate unchanged: every page.tsx keeps its `createClient()` + `createAdminClient()` + role-table lookup at the top.
- Server Components fetch data; client `<DataGrid>` receives initial rows + a typed `editableEndpoint` prop pointing at the existing PATCH routes (`/api/loan-officer/borrowers`, `/api/loan-officer/brokers`; admin equivalents added if missing).
- Filtering, sorting, and column visibility are pure client work.

### Components retired

- `AdminContactList` → replaced by `<DataGrid>` with admin column sets.
- `EditableContactList` → replaced by `<DataGrid>` + `<EditableCell>`.
- The three-section card layout in `loan-officer/vendors/page.tsx` → replaced by the unified vendors grid.

## Testing strategy

Per the project's `CLAUDE.md`: no automated tests; the build is the correctness gate. Manual verification will use the Playwright MCP to exercise:

1. Each of the five surfaces loads, shows the expected default columns, and renders rows.
2. Toggle a column off → it disappears; URL updates with the new `cols` param.
3. Sort each column → values reorder; URL updates with `sort`.
4. Filter a text column → matching rows show only; URL updates with `filter:<col>`.
5. Click a cell, edit, press Enter → value persists; refresh → value still there.
6. Click chevron → navigates to detail or loan page as appropriate.
7. Cross-role check: admin sees all rows; LO sees only their scoped rows.
8. Five-role gate sanity (`playwright-role-gates`): non-admin cannot reach `/admin/borrowers` etc.

## Risks

1. **Click-to-edit is a new interaction pattern in this app.** Will likely need 1–2 polish passes after the user sees it live. Mitigation: ship the chevron-navigation affordance from day one so users always know how to "open" a row.
2. **`last_loan_activity` column requires an extra aggregation against `loans`.** Cost is small at current scale but adds latency. Mitigation: column is in the menu but hidden by default; users opt in.
3. **No server-side filtering in v1.** If a single LO's borrower count exceeds ~5k, the page will get sluggish. Acceptable for now; the `<DataGrid>` contract will not change when server-side is added.
4. **Vendors stays derived in v1.** The grid does not support editing vendor cells. This is called out in the column UX (cells render plain text without click-to-edit affordance). The follow-up vendors-as-real-data spec will replace that surface end-to-end.
5. **Branch hygiene.** Merging `main` into `feature/loan-application-intake` may produce conflicts on `portal-shell.tsx` and other touched files. The merge happens before any grid work, so conflicts surface early.

## Out of scope reminders

- New `vendors` DB table (separate spec).
- Saved views / user preferences persistence (separate spec).
- Bulk selection and bulk actions (separate spec).
- Server-side filtering and pagination (separate spec; triggered if row counts explode).
- Multi-column sort (small follow-up after v1 lands).

## Open questions resolved during brainstorming

1. **Library:** shadcn data-table recipe on top of `@tanstack/react-table`.
2. **State persistence:** URL query params.
3. **Detail navigation:** Admin → new detail pages; LO → loan page.
4. **Editing UX:** Click-to-edit cells, chevron-to-navigate.
5. **Vendors:** Single unified grid with a Type column; stays derived in v1.
6. **Scope:** All five surfaces in one project.
7. **Branch:** Merge `origin/main` into `feature/loan-application-intake` as step 0.
