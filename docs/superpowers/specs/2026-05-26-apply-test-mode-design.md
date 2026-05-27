# Apply: Admin Test Mode

Date: 2026-05-26
Proposed branch: `feature/apply-test-mode` cut off `feature/apply-confirmation-pdf` (stacks on PR #8; this is its own reviewable change).
Status: Design approved in brainstorm; awaiting spec review before planning.

## Problem

Testing the `/apply` flow today means hand-filling a 5-step wizard, which is slow and error-prone. Worse, a real submit writes a `loans` + `borrowers` + `documents` row and sends real emails - so testing pollutes production data. There is no way to exercise the **full** submit pipeline (PDF + emails) without creating a live loan.

## Goals

1. An **admin-only** "Test mode" that, when toggled on, lets the admin:
   - Populate the wizard with realistic random data from a chosen scenario in one click.
   - Override the three email recipients (borrower, processing inbox, assigned LO) per test.
   - Submit and have the full PDF + email pipeline run, but **nothing written to live tables, storage, or auth.users**.
2. Visibly distinguish a test run from a real run (banner, subject prefix, diagnostic confirmation page).
3. A few targeted helpers that speed iteration: PDF preview (no submit), auto-submit (fill + submit in one click), skip-to-step.

## Non-goals

- Programmatic test API for CI / no-auth automation (deferred; admin auth is the gate).
- A test-runs audit log (deferred to v2).
- Resend dry-run / no-email mode (deferred to v2 - the override-emails approach already prevents pollution).
- Reproducible "random" seeds (deferred to v2).
- A separate `/apply-test` route. Test mode lives on the real `/apply` so it exercises the actual code path users hit.

## Key context (verified in code)

- `/apply` is currently a public, unauthenticated client-only wizard. The page server-renders `<Wizard initialData initialStep initialToken />` ([src/app/apply/page.tsx](../../../src/app/apply/page.tsx)).
- The wizard already understands `?dev=1` as a client URL flag that bypasses required-field gating ([wizard.tsx:52-55](../../../src/app/apply/_components/wizard.tsx#L52-L55)).
- Admin auth pattern across the portal: server-side Supabase auth, then `adminClient.from('admin_users').select('id').eq('auth_user_id', user.id).single()`. We can reuse it unchanged in the `/apply` server component without breaking the public path.
- Submit pipeline: `POST /api/apply/submit` reads draft from `loan_applications.data`, writes loans/borrowers/details/demographics/events/documents + storage + auth user (in `after()`), sends emails via `apply-notify.ts`. `renderApplicationPdf(data)` is a pure function that returns a Buffer ([application-pdf.tsx](../../../src/lib/pdf/application-pdf.tsx)); we reuse it as-is for test mode.
- `sendEmail` ([mailer.ts](../../../src/lib/mailer.ts)) supports Buffer attachments, which the test-mode internal email uses to skip storage entirely.

## Design

### 1. Server-side admin gate
- Convert `src/app/apply/page.tsx` to a server component that performs the existing admin lookup. Pass an `isAdmin: boolean` prop into the wizard.
- Non-admins see exactly today's page (no toggle, no panel). Public flow is preserved.

### 2. Test-mode toggle
- When `isAdmin === true`, the wizard renders a small "Test mode" toggle (top-right corner). Off by default.
- State persisted to `localStorage` (`fe-apply-test-mode: '1' | '0'`) so it survives reloads.
- Off -> wizard behaves exactly as it does today.
- On -> the test panel appears, autosave is suppressed, "Submit" routes to the test endpoint, and a yellow "Test mode" banner is shown across the top.

### 3. Test panel - `src/app/apply/_components/test-mode-panel.tsx` (new)
A compact panel visible when the toggle is on, containing:
- **Scenario picker** (dropdown): `Fix & Flip Purchase`, `Fix & Flip Refi`, `DSCR Single Family`, `DSCR Multifamily (4 units)`, `Bridge New Construction`. Each maps to a builder that returns a complete valid `ApplicationData`.
- **Email overrides**: three text inputs (borrower / processing inbox / LO), persisted to `localStorage` (`fe-apply-test-overrides`). Defaults to `apalmiotto@outlook.com` for all three on first use.
- **Fill with test data** button - applies the chosen scenario to the wizard's working data. Re-clicking randomizes (fresh names/addresses/amounts/dates within the scenario's shape).
- **PDF preview** button - POSTs current data to `POST /api/apply/test-pdf` and downloads the resulting PDF. No submit, no emails, no DB.
- **Auto-submit** button - fills with the chosen scenario then triggers test-submit. One-click end-to-end smoke.
- **Skip-to-step** quick links (1-5).

### 4. Test data generators - `src/lib/test-data/` (new)
- `generators.ts` - small pure helpers: `randomName()`, `randomAddress()` (street + real US city/state/zip pairs from a short hand-curated list), `randomCurrency(min, max)`, `randomDate(yearsBack)`, `randomSSN()`, `randomPhone()`. Uses `Math.random` - no faker dependency.
- `scenarios.ts` - one builder per scenario, returning `ApplicationData`. Builders compose the generators so re-runs randomize while staying inside each scenario's required-field shape (verified against `missingRequired` in the submit route).

### 5. Test submit endpoint - `src/app/api/apply/test-submit/route.ts` (new)
- `POST { data: ApplicationData, overrides: { borrowerEmail, processingInbox, loEmail } }`. No `resumeToken`.
- Re-checks admin auth server-side (otherwise 403). Rate-limited per admin (separate bucket from the real submit).
- Runs `missingRequired` (the existing validator) - if anything's missing, returns 422 with the missing list so the panel can highlight it.
- Generates the PDF via `renderApplicationPdf(data)`.
- Calls `sendApplicationTestNotifications({ data, pdf, overrides })` (the test orchestrator, see next section).
- Returns `{ success: true, recipients: { borrower, internal: [...] }, pdfBytes, scenario }`.
- **Touches none of:** `loans`, `borrowers`, `loan_details`, `loan_demographics`, `loan_events`, `documents`, `loan_applications`, `storage`, `auth.users`.

### 6. Test-mode orchestrator - `src/lib/apply-notify-test.ts` (new)
Parallel to `apply-notify.ts` but for test mode. Sends:
- **Borrower email**: subject `[TEST] We received your First Equity loan application`. Same template as prod, with the activation block replaced by an inline note: "Test mode - activation link not generated."
- **Internal email**: subject `[TEST] New loan application - <property>`. Same template as prod, **with the masked PDF attached directly** (Buffer) instead of a download link. Includes a "TEST MODE" marker block.
- Recipients come from `overrides` (validated as `@`-containing strings). The internal email goes to `[processingInbox, loEmail]`, deduped.
- **Skips** `ensureBorrowerActivationLink` (no auth user creation, no recovery link).

### 7. PDF preview endpoint - `src/app/api/apply/test-pdf/route.ts` (new)
- `POST { data: ApplicationData }`. Admin-only.
- Generates the PDF and returns it with `Content-Type: application/pdf` and a download `Content-Disposition`. No email, no storage, no DB.

### 8. Test confirmation page - `src/app/apply/test-submitted/page.tsx` (new)
After a test submit, the wizard redirects here (with the result info in `sessionStorage` since there's no resumeToken / loan id to carry). Renders a yellow-banner confirmation showing:
- Scenario used.
- Recipient addresses (borrower, processing inbox, LO).
- PDF byte count + a "Re-render and download the PDF" button (re-uses `/api/apply/test-pdf` with the same data from sessionStorage).
- "Run another test" link back to `/apply` with the toggle still on.

### 9. Autosave suppression
The wizard's autosave hook ([use-autosave.ts](../../../src/app/apply/_components/use-autosave.ts)) is suppressed when test mode is on (one-line guard at the hook entry, controlled by a prop). Test data instead persists to `localStorage` so refresh keeps it.

### 10. File summary

New:
- `src/lib/test-data/generators.ts`
- `src/lib/test-data/scenarios.ts`
- `src/lib/apply-notify-test.ts`
- `src/app/api/apply/test-submit/route.ts`
- `src/app/api/apply/test-pdf/route.ts`
- `src/app/apply/_components/test-mode-panel.tsx`
- `src/app/apply/test-submitted/page.tsx`

Edited:
- `src/app/apply/page.tsx` (server component; admin check; pass `isAdmin`)
- `src/app/apply/_components/wizard.tsx` (toggle, test-mode state, panel mount, banner, route to test submit, autosave suppression)
- `src/app/apply/_components/use-autosave.ts` (accept a disable flag)

## Risks / decisions

- **Email abuse via the override inputs.** Even with admin gate + rate limit, an admin's session could in theory be used to fire emails to arbitrary recipients through your sending domain. Mitigations: admin-only, per-admin rate limit, `[TEST]` subject prefix, server-side validation that recipient addresses are well-formed.
- **Admin auth makes `/apply` non-public-rendered.** The change keeps the page public to anonymous visitors (server falls through to no-test mode for non-admins). Need to verify the auth check failing (no session at all) cleanly produces the anonymous render path, not a 401.
- **Activation flow is not exercised end-to-end in test mode** (skipped to avoid `auth.users` pollution). That code path is verified by the prod e2e in PR #8 with an existing-account collision; a fresh-account walk-through stays a manual one-off.
- **Internal email attachment vs link**: prod uses a long-lived signed URL to a stored PDF; test attaches the PDF inline. The attachment path is what was originally specced for the internal email before we chose link-only, so the test orchestrator's attachment behavior is well-trodden territory.
- The `[TEST]` subject prefix only protects against confusion if recipients read subjects; the email body also includes a "TEST MODE" marker block as a second signal.

## Verification plan (Phase 6)

1. `tsc --noEmit` clean; `next build` green.
2. **Manual non-admin** check: open `/apply` in an incognito window -> no toggle visible, page identical to today.
3. **Manual admin** check: log in as admin, open `/apply` -> toggle visible; flip on; pick a scenario; PDF preview downloads a sensible PDF; auto-submit lands on `/apply/test-submitted` with the correct recipients; both emails arrive with `[TEST]` subjects and the PDF attached to the internal one.
4. **Negative**: while toggle is on, confirm `loan_applications`, `loans`, `borrowers`, `documents` show no new rows for the test run (probe via Supabase REST after a submit).
5. **Regression**: with toggle off (admin), submit behaves as today (real loan written, prod orchestrator runs). Confirm by submitting one real test loan and cleaning it up the same way as the PR #8 e2e.

## Open question for the user (asked at brainstorm; recorded for context)

None blocking. The design captures the user's choice for the gate (admin auth + explicit on/off toggle) and the recommended v1 scope.
