# New vs Returning Borrower Entry Gate

Date: 2026-06-18
Status: Approved (brainstorm), pending implementation plan
Owner: apalmiotto

## Problem

When someone goes to the loan application, the app should first ask whether
they are a first-time First Equity Funding borrower or a returning customer.

- New customers complete the application; on submit a portal account is created
  for them and they receive an email with instructions on how to access it.
- Returning customers are prompted to log into their portal account, and when
  they start a new application their personal and previously saved information
  is pre-populated so they only have to add the new property/deal.

A hard requirement from the user: this must all happen on a **single URL**.
There must be no separately navigable "new application" route, so an existing
borrower can never deep-link past the gate into a blank application.

## Goals

1. A new-vs-returning chooser at the application entry point.
2. Returning borrowers identified by email via the existing passwordless
   one-time-code login, then dropped into a pre-filled new application.
3. New borrowers get a portal account auto-created at submit, plus an
   access-instructions email.
4. The entire flow lives at one URL (`/apply`); no blank-application URL exists.

## Non-goals

- No change to the broker application flow (`/broker/apply`).
- No new identity verification beyond the existing email + OTP login (no
  name/DOB challenge).
- No schema changes.
- No change to the post-submit pipeline, notifications, or Square payment step
  beyond adding account creation.

## Key existing assets (reused, not rebuilt)

- `src/lib/application/variants.ts` already defines the feature flags
  `prefillFromAuthenticatedUser` and `createDraftOnLoad` (both currently
  `false`). The original author anticipated authenticated pre-fill.
- `src/lib/invite-borrower.ts` -> `ensureBorrowerActivationLink` already
  creates/links an auth user, generates a single-use 24h recovery link, and
  sends a welcome email. It is idempotent: a borrower that already has an
  `auth_user_id` is a no-op.
- `src/app/login/login-client.tsx` already performs the passwordless OTP flow
  client-side (`signInWithOtp` with `shouldCreateUser: false`, then
  `verifyOtp`). This logic is reused inline.
- `src/app/api/apply/check-account/route.ts` already detects whether an email
  already has a borrower account. Kept as a backstop.
- `src/lib/application/submit-core.ts` already upserts the `borrowers` row by
  email and sends submitted-notifications off the critical path via `after()`.
- `redirects.afterSubmit` is already `/apply/submitted` (confirmation page).
- The `borrowers`, `loan_applications`, `loan_details`, `loan_demographics`
  tables already hold everything needed for pre-fill. No migration required.

## Identification decision

Returning borrowers are found by **email** through the existing passwordless
login (email + 6-digit code). Logging in is itself the proof of identity, so no
name or DOB challenge is added. An email-only lookup without login is explicitly
rejected because it would leak one borrower's personal data (SSN/DOB level) to
anyone who types their email.

## Pre-fill decision

When a returning borrower starts a new application, pre-fill the **full personal
profile** from their most recent submitted application:

- Carried over: name, DOB, SSN, contact info, current/prior address,
  citizenship/legal status, marital status, credit score, entity info,
  experience (flips/rentals/other), and HMDA demographics.
- Always blank: all property/deal fields and unit fields (this is a new
  property every time).
- Always re-confirmed fresh: declarations and the authorization/e-signature/
  payment step. These are per-application legal attestations and must be
  re-signed each time, never inherited.

Source of pre-fill data, in priority order:

1. The most recent `loan_applications` row for the borrower's email with
   `status = 'submitted'`, using its `data` jsonb (the full form payload),
   with property/deal/unit, declaration, and authorization/signature/payment
   keys stripped out.
2. Fallback for legacy borrowers (came from Airtable/Pipedrive, no
   `loan_applications` row): pre-fill the core fields stored on the `borrowers`
   row (name, phone, current/prior address, entity name). SSN/DOB/credit are
   not recoverable for these borrowers and stay blank.

Pre-fill is gated strictly on the authenticated session's own `auth_user_id`.
Data is never selected by a client-supplied email or id, so cross-borrower
leakage is structurally impossible.

## Single-URL flow

`/apply` is the only route. There is no `/apply/new`. The page is a Server
Component that decides what to render, in this order:

1. **Authenticated borrower** (valid session, maps to a `borrowers` row):
   render the wizard pre-filled with their stripped prior data. This is the
   only way an authenticated borrower can see the form, so they can never reach
   a blank application.
2. **Embed mode** (`?embed=1` or `?testkey=` present): render the blank form
   directly (the WordPress iframe is cross-site and unauthenticated). This
   preserves the existing embed with zero WordPress-side change.
3. **Unauthenticated, normal visit**: render a client gate component
   (`ApplyGate`) that manages three inline states on the same URL:
   - **Chooser**: "First time with First Equity Funding" vs "Returning
     customer".
   - **First time** -> the blank wizard renders inline. On submit, the account
     is auto-created and the access email is sent.
   - **Returning** -> the email + OTP login renders inline (reusing the OTP
     calls from `login-client`). On a correct code the session cookie is set,
     the client calls `router.refresh()`, the Server Component re-renders, sees
     an authenticated borrower (case 1), and returns the pre-filled form. The
     URL never changes.

### Why this closes the deep-link gap

- No blank-application URL exists to navigate to.
- An authenticated borrower at `/apply` always gets the pre-filled form
  (enforced server-side), never a blank one.
- A "first time" applicant who types an email that already has an account is
  caught by the existing `check-account` backstop and switched into the inline
  login instead of filing a blank duplicate.

## New-borrower account creation at submit

In `submit-core.ts` (borrower variant only), after the loan and related rows
are written and before/alongside the existing notification step:

- Call `ensureBorrowerActivationLink` for the borrower's email.
  - Brand-new borrower: creates the auth user, generates the single-use 24h
    sign-in link, and sends the access-instructions email (welcome + link).
  - Returning borrower (already has `auth_user_id`): no-op, and no duplicate
    access email is sent.
- The access email is sent off the critical path (consistent with existing
  `after()` notifications) so a mail failure can never fail a submission.
- The confirmation page (`/apply/submitted`) copy reflects: application
  submitted, check your email to access your portal.

## Components and files (anticipated; finalized in the plan)

- `src/app/apply/page.tsx` - becomes the server-side decider (auth / embed /
  gate). Moves the wizard render behind the three cases above.
- `src/app/apply/_components/apply-gate.tsx` (new) - client chooser + inline
  login state machine for the unauthenticated case.
- `src/app/apply/_components/wizard.tsx` - accept optional `initialData` and
  honor `prefillFromAuthenticatedUser`; skip the duplicate-account check when
  the user is authenticated.
- `src/lib/application/prefill.ts` (new) - server helper that loads + strips the
  prior application data for a given authenticated borrower.
- `src/lib/application/variants.ts` - flip `prefillFromAuthenticatedUser` (and
  `createDraftOnLoad` as needed) for the authenticated borrower path.
- `src/lib/application/submit-core.ts` - call `ensureBorrowerActivationLink`
  after submit (borrower variant).
- `src/app/apply/submitted/page.tsx` - confirmation copy update.
- `docs/embed-on-wordpress.md` - no snippet change required (embed shim keeps
  `/apply?embed=1` working); add a note documenting the shim behavior.

## Error handling

- OTP failures inside the inline login surface the same messages the existing
  login page shows; the user stays on `/apply` and can retry.
- If pre-fill data load fails, the form renders blank rather than blocking the
  borrower (degrade gracefully; log the error).
- If the access email fails to send, the submission still succeeds; the failure
  is logged and the borrower can use the standard login (email + code) to get
  in, so they are not locked out.

## Security and verification (production-sensitive surface)

This touches authentication and account creation on a live system, so:

- Phase 5 runs `security-review` (not optional).
- Phase 6 runs the project `playwright-role-gates` skill (drives all five role
  sign-ins to confirm no role can reach another role's routes) plus a real
  browser walkthrough of both the new and returning paths. A green
  `next build` alone does not count as verified.
- Specific checks: pre-fill is only ever derived from the session's own
  `auth_user_id`; the inline login uses `shouldCreateUser: false`; no
  borrower-supplied identifier is trusted for data selection.

## Open questions

None blocking. Legacy-borrower partial pre-fill (core fields only) is accepted.

## Success criteria

1. Visiting `/apply` unauthenticated shows the new-vs-returning chooser.
2. Choosing "First time" lets a new borrower complete and submit; a portal
   account is created and an access-instructions email is received.
3. Choosing "Returning" shows inline email + code login; on success the same
   URL shows a new application pre-filled with the borrower's personal/saved
   info, with property/deal blank and declarations/authorization unsigned.
4. An authenticated borrower visiting `/apply` always gets the pre-filled form,
   never a blank one. There is no other URL that renders a blank application.
5. The WordPress embed (`/apply?embed=1`) still renders the form directly with
   no WordPress-side change.
6. All five role gates still pass; security review passes.
