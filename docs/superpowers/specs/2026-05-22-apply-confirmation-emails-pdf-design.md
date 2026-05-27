# Apply: Confirmation Page, Transactional Emails, Application PDF

Date: 2026-05-22
Branch: `feature/apply-confirmation-pdf` (cut from `feature/collapsible-sidebar`, the complete apply base)
Status: Design approved in brainstorm; awaiting spec review before planning.

## Problem

When a public loan application is submitted at `/apply`, the post-submit experience is thin:

- The confirmation page ([src/app/apply/submitted/page.tsx](../../../src/app/apply/submitted/page.tsx)) is 10 static lines with no next steps and no portal-account prompt.
- The borrower confirmation email is a bare "we received it" note with no way to access the portal.
- The "loan officer notice" emails a **random** loan officer (`select('email').limit(1)`), not the assigned one, and carries no copy of the application.
- Processing staff get nothing, and there is no durable, nicely-formatted record of the submitted application anywhere a human can read it.

## Goals

1. A polished confirmation page that tells the applicant what happens next and prompts them to activate their portal account (via the email).
2. A borrower confirmation email that contains an **activate-your-portal-account** link and a light recap. No sensitive data (no SSN, DOB, credit score), no attachment.
3. An internal email to the **shared processing inbox + the assigned loan officer** with a link to a nicely-laid-out **PDF of the full application** (SSN masked to last 4).
4. The application PDF is **stored in the portal**, attached to its loan, and viewable/downloadable from the loan record.
5. All email continues to flow through **Resend** (already in place).

## Non-goals (explicitly out of scope)

- **Removing the $45 application charge** / charging manually after review - separate follow-up task. Keep HMDA collection as-is.
- Live LTV/DSCR readouts - skipped per request.
- Resend domain authentication (SPF/DKIM/DMARC), human-readable reference numbers, BCC archive address - deferred. Domain auth remains a **pre-launch checklist item** for deliverability (not built here).
- Wiring previously-uploaded **property_documents** to the loan - related but separate outstanding item.
- The future "loan officer list driven by active LO portal users" - this build ships a forward-compatible seam only.

## Key context (verified in code)

- Submit handler: [src/app/api/apply/submit/route.ts](../../../src/app/api/apply/submit/route.ts), `runtime = 'nodejs'`, idempotent (short-circuits when `status === 'submitted'`). Step 6 sends the current best-effort emails. Returns `{ success, loanId }`.
- Full application data lives in `loan_applications.data` (JSONB `ApplicationData`): `primary`, `co_borrowers[]`, deal fields at root, `units[]`, declarations, HMDA, experience, `auth_signature`.
- Field metadata (labels, sections, types) is the single source of truth in [src/lib/application-fields.ts](../../../src/lib/application-fields.ts) (`BORROWER_FIELDS`, `PRIMARY_EXTRA_FIELDS`, `DEAL_FIELDS`, `UNIT_FIELDS`, `EXPERIENCE_FIELDS`, `DECLARATION_FIELDS`, `HMDA_FIELDS`, `LOAN_OFFICER_OPTIONS`). The assigned LO is `data.primary.loan_officer_assigned`.
- Sensitive field to mask: `ssn` (type `ssn`) on `primary` and each `co_borrowers[i]`.
- Email plumbing: [src/lib/mailer.ts](../../../src/lib/mailer.ts) `sendEmail()` (Resend, supports Buffer attachments), [src/lib/email.ts](../../../src/lib/email.ts) (`wrap()` branded template helper, `sendApplicationSubmittedEmail`, `sendApplicationLoanOfficerNotice`). `MAIL_FROM` is the verified `irongateportals.com` sender.
- Borrower provisioning: [src/lib/invite-borrower.ts](../../../src/lib/invite-borrower.ts) - `inviteBorrower()` creates/links a Supabase auth user, generates a `recovery` link to `/auth/callback?next=/dashboard`, and sends its own email. Handles three cases (new / intake-row-without-auth / already-linked).
- Documents: table `documents` (`loan_id` NOT NULL, `condition_id` nullable, `file_name`, `file_path`, `file_size`); private storage bucket `documents`. Server-side write: `adminClient.storage.from('documents').upload(path, buffer, { contentType })` then insert a `documents` row. Loan pages list docs by `loan_id` and mint `createSignedUrl(path, 3600)` for download via [src/components/documents-list.tsx](../../../src/components/documents-list.tsx).
- **Access model (critical):** staff visibility is app-level, not RLS. Admins see all loans; LO/LP/UW only see loans **assigned** to them. A fresh `'New Application'` has no assignments, so a **portal deep-link would 404 for the processing inbox and the LO** - which is why the internal email uses a **signed download link**, not a portal page link. The borrower can see their own loan (`borrower_id` is set on submit).

## Design

### 1. Application PDF generator - `src/lib/pdf/application-pdf.tsx` (new)

- Library: **`@react-pdf/renderer`** (pure Node, `renderToBuffer`, no headless browser, reliable on Vercel; the route already runs the Node runtime). New dependency.
- Export `renderApplicationPdf(data: ApplicationData): Promise<Buffer>`.
- Layout: navy (`#1F5D8F`) header band with "First Equity Funding - Loan Application" and submission date; sections mirroring the wizard - Primary Borrower, Co-Borrowers (repeat), Deal / Property, Experience, Declarations, HMDA, Authorization (signature + timestamp). Field labels/sections pulled from `application-fields.ts`; only render fields that are present/visible. Footer with page numbers and a "Confidential" line.
- **SSN masking:** a `maskSSN()` helper renders `XXX-XX-1234` for `primary.ssn` and every `co_borrowers[i].ssn`. Masking happens in the generator so every consumer is safe by construction.

### 2. PDF storage + non-expiring link - within the notify orchestrator

- Upload the Buffer to the private `documents` bucket at `loans/{loanId}/loan-application.pdf` (`contentType: 'application/pdf'`, `upsert: true`).
- Insert a `documents` row: `{ loan_id: loanId, condition_id: null, file_name: 'Loan Application - {property}.pdf', file_path, file_size }`. With `condition_id` null it appears as a standalone document on the loan, viewable by admins now and by the LO/processor/borrower once they have access.
- Mint an **effectively non-expiring** signed URL via `createSignedUrl(path, TEN_YEARS)` (bucket stays private; acceptable because the PDF masks sensitive data, per decision). New tiny helper `getSignedDocumentUrl(adminClient, path, ttlSeconds)` in `src/lib/supabase/signed-url.ts`.

### 3. Borrower activation link - refactor `src/lib/invite-borrower.ts`

- Extract `ensureBorrowerActivationLink(email, fullName?): Promise<string>` that performs the create/link-auth-user logic and returns the `recovery` action link, **without** sending an email.
- `inviteBorrower()` is refactored to call it and then send its existing invite email (behavior unchanged for current callers).
- Idempotent across all three account states; for an already-registered borrower the recovery link doubles as a sign-in link.

### 4. Emails - extend `src/lib/email.ts`

- **`sendApplicationSubmittedEmail(email, firstName, propertyAddress, activationLink, recap)`** (enhanced): keeps the branded `wrap()` shell; adds an "Activate your portal account" button (`activationLink`) and a light recap (property address, loan type, requested amount). **No SSN/DOB/credit, no attachment.**
- **`sendApplicationInternalNotice({ to, applicantName, propertyAddress, loanType, loanAmount, loanId, pdfUrl, loanOfficerName })`** (new): to the processing inbox + assigned LO. Summary block + a "Download application (PDF)" button (`pdfUrl`) + note that the application is also saved on the loan in the portal. Replaces the old random-LO `sendApplicationLoanOfficerNotice` usage in the route.

### 5. Loan-officer routing seam - `src/lib/loan-officer-emails.ts` (new)

- `LOAN_OFFICER_EMAILS: Record<string, string>` keyed by the exact `LOAN_OFFICER_OPTIONS` names (9 real + "Other"). Values supplied by the user; unknown names map to nothing.
- `resolveLoanOfficerEmail(name?: string): string | null`. Single swappable function: the future "active LO portal users" version replaces only this body. `"Other"`/unmapped -> `null` -> internal email still goes to the processing inbox alone.

### 6. Notify orchestrator - `src/lib/apply-notify.ts` (new)

`sendApplicationNotifications({ loanId, data, meta })` runs the whole post-submit side-effect chain, each step best-effort and individually logged:
1. `renderApplicationPdf(data)` -> Buffer.
2. Upload to storage + insert `documents` row.
3. `getSignedDocumentUrl(...)` -> `pdfUrl`.
4. `resolveLoanOfficerEmail(data.primary.loan_officer_assigned)` -> `loEmail`.
5. `ensureBorrowerActivationLink(meta.primaryEmail, primaryFullName)` -> `activationLink`.
6. `sendApplicationSubmittedEmail(...)` (borrower) and `sendApplicationInternalNotice({ to: [PROCESSING_INBOX, ...(loEmail ? [loEmail] : [])], ... })`.

Keeps the route lean and the side effects unit-reasonable in isolation.

### 7. Submit route wiring - `src/app/api/apply/submit/route.ts`

- Replace the step-6 email block. After the success response is determined, schedule the orchestrator with **Next.js `after()`** (`import { after } from 'next/server'`) so PDF generation + uploads + emails run **after** the response is sent and stay off the applicant's critical path. Registered only in the first-submit success path (idempotency preserves "no double-send" on retries). If `after` proves unavailable, fall back to the existing inline best-effort await.

### 8. Confirmation page - `src/app/apply/submitted/page.tsx`

- Polished, centered navy card matching the portal aesthetic: success state, "Application received", a prominent **"Check your email to activate your portal account"** prompt (activation arrives by email per decision), and a 3-step "What happens next" timeline (we review -> your loan officer reaches out -> next steps/closing). Static (no query params required).

### 9. Environment / config

- `APPLICATIONS_PROCESSING_INBOX` (new) - shared processing inbox address. Supplied by the user; if unset, the internal email simply omits that recipient (LO-only) and logs a warning.
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` - unrelated to this build's code but required to activate the already-built address autocomplete + Street View (see Appendix A).
- New dependency: `@react-pdf/renderer`.

## File summary

New:
- `src/lib/pdf/application-pdf.tsx`
- `src/lib/loan-officer-emails.ts`
- `src/lib/apply-notify.ts`
- `src/lib/supabase/signed-url.ts`

Edited:
- `src/lib/email.ts` (enhance borrower email; add internal notice)
- `src/lib/invite-borrower.ts` (extract activation-link helper)
- `src/app/api/apply/submit/route.ts` (replace step 6 with `after()` orchestrator call)
- `src/app/apply/submitted/page.tsx` (polished confirmation + activation prompt)

## Inputs needed from the user (before/at execution)

- The **shared processing inbox** address.
- The **loan-officer email map** (9 names; "Other" has none). Build compiles without it via clearly-marked TODO placeholders.

## Risks / decisions

- **Best-effort side effects.** PDF storage + emails run in `after()` and are non-fatal; a failure means the loan still submits but the PDF/email may be missing. Logged for follow-up. (Alternative: block on storage before responding for guaranteed persistence at the cost of ~1-3s latency - revisit if needed.)
- **Non-expiring signed URL.** A long-lived signed URL cannot be revoked without rotating storage keys, and breaks if the object is moved. Acceptable because the PDF masks sensitive data (explicit decision). Bucket remains private.
- **`after()` availability** in the deployed Next.js 16 runtime - verify during execution; inline fallback exists.
- **Build is the correctness gate** (no test suite). Verification must include a real submit walkthrough (preview deploy or local with Playwright), not just `next build`.

## Verification plan (Phase 6)

1. `npx tsc --noEmit` clean (dev server holds the build lock).
2. Submit a test application end-to-end: confirm the confirmation page renders, the borrower receives an email with a working activation link, the internal email reaches the processing inbox + resolved LO with a working PDF download link, the PDF masks SSN and is well laid out, and the document appears on the loan in the portal (admin view).
3. Re-submit/refresh to confirm no duplicate emails/loans (idempotency).
4. Confirm `/apply` auth-exemption is intact (public route) and no role-gate regressions, per `playwright-role-gates` if any auth surface is touched (this build does not change role checks, but the activation flow creates auth users - sanity-check it does not alter existing role gating).

## Appendix A - Google Maps activation (no code; documentation)

The address autocomplete + Street View components already exist and degrade gracefully without a key. To activate:

- Env var: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (in `.env.local` and Vercel Production + Preview).
- Enable in Google Cloud (one project, billing enabled): **Maps JavaScript API**, **Places API** (legacy; the classic `places.Autocomplete` widget), **Street View Static API**.
- Restrict the key: HTTP referrers (`http://localhost:3000/*`, `https://*.vercel.app/*`, prod domain) and restrict to the three APIs above.
- Restart the dev server (`NEXT_PUBLIC_*` is inlined at build time).
