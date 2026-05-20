# Passwordless Login Migration — Design

**Date:** 2026-05-20
**Status:** Draft, pending approval
**Scope:** FE-Portal (Next.js 16, Supabase Auth, app router)

## Goal

Replace password-based login with passwordless email authentication (6-digit OTP code *or* magic link, user's choice). Move **all auth emails** (login codes + password reset) from Nodemailer/Gmail to Resend, with branded HTML templates living in the repo. Maintain a 30-day transition window where existing users can still sign in with their old password as an escape hatch.

## Non-goals

- Adding social/OAuth login (separate effort, not blocked by this work).
- Migrating **non-auth** transactional emails — `sendStageUpdateEmail`, `sendLoanFundedEmail`, `sendApplicationSubmittedEmail`, `condition-action` emails — off Nodemailer/Gmail. Those stay on the current path and can migrate to Resend in a follow-up effort.
- Multi-factor authentication. OTP-as-second-factor is out of scope; this is OTP-as-primary.

## Current state (verified 2026-05-20)

- **Auth:** Supabase Auth via `@supabase/ssr` 0.10.2 + `@supabase/supabase-js` 2.105.1.
- **Login page:** `feportal/src/app/login/page.tsx` — calls `supabase.auth.signInWithPassword()`.
- **Password reset:** `feportal/src/app/auth/forgot-password/page.tsx` + `feportal/src/app/api/auth/forgot-password/route.ts` — already uses `supabase.auth.admin.generateLink()` for magic links.
- **Invites / set-password:** `feportal/src/app/auth/set-password/page.tsx` — PKCE-based.
- **Users table:** Supabase-managed `auth.users` (no custom users table).
- **Email sending today:** Nodemailer + Gmail SMTP via `feportal/src/lib/email.ts`. `RESEND_API_KEY` is in env (Resend SDK v6.12.2 installed but unused).
- **Hosting:** Vercel.

## Decisions

| Decision | Choice |
|---|---|
| Methods offered | Both 6-digit OTP code **and** magic link, on the same screen |
| Existing passwords | Left intact in `auth.users`; password login surfaced as a "Use password instead" fallback link |
| Transition window | 30 days from passwordless launch, then the password fallback is removed |
| Invite flow | Invite link logs the new user in directly; no set-password page |
| Login page structure | Single page, progressive reveal (email step → code step on same route) |
| OTP code length | 6 digits, numeric |
| OTP TTL | 10 minutes |
| Resend cooldown | 60 seconds between code requests for the same email |
| Verify attempts | Max 5 per code before invalidation |
| Send rate limit | Max 5 send requests per email per hour |
| Email transport | Resend SDK called from Next.js API routes (mirrors existing `forgot-password` pattern, swap Nodemailer→Resend) |
| Email templates | Live in repo at `src/lib/emails/auth/`, version-controlled |
| OTP generation | `adminClient.auth.admin.generateLink({ type: 'email', email })` returns both the 6-digit code and a magic link |

## Architecture

### Email delivery — Resend SDK called from API routes

Auth emails are sent from Next.js API routes using the Resend SDK directly. This mirrors the existing `forgot-password/route.ts` pattern (which calls `admin.generateLink()` + Nodemailer) — we swap Nodemailer for Resend and keep everything else.

**Why not Supabase's built-in email sending?** Because:
1. Templates would live in Supabase's web dashboard, outside the repo — no version control, no peer review, lost if the project is rebuilt.
2. The repo would have two auth-email patterns (app sends password reset; Supabase sends OTP). One pattern is better.

**Building blocks (new):**

- **`src/lib/resend.ts`** — thin wrapper that exports a memoized Resend client built from `RESEND_API_KEY`. Pattern mirrors `src/lib/supabase/admin.ts`.
- **`src/lib/emails/auth/sign-in-code.ts`** — exports `renderSignInCodeEmail({ code, magicLink })` returning `{ subject, html }`. Branded HTML matching the existing forgot-password email style.
- **`src/lib/emails/auth/password-reset.ts`** — same shape, hosts the password-reset HTML that's currently inline in `forgot-password/route.ts`.
- **`src/lib/emails/send.ts`** — exports `sendAuthEmail({ to, subject, html })` that calls Resend with `from = "First Equity Funding <auth@<verified-domain>>"`. Single chokepoint for retries/logging.

**Auth flows (new and migrated):**

- **OTP send (new):** `POST /api/auth/send-otp`
  - Body: `{ email: string }`
  - Calls `adminClient.auth.admin.generateLink({ type: 'email', email })` — Supabase returns both `properties.email_otp` (6 digits) and `properties.action_link` (magic link URL).
  - Renders with `renderSignInCodeEmail` and sends with `sendAuthEmail`.
  - Always returns `{ success: true }` regardless of whether the email exists, to prevent enumeration.
  - In-memory + DB-backed rate limiting (see "Rate limiting and abuse" below).

- **OTP verify:** stays client-side. Login page calls `supabase.auth.verifyOtp({ email, token, type: 'email' })` directly — no server route needed because Supabase verifies the code natively.

- **Password reset (migrated):** `POST /api/auth/forgot-password` is rewritten to use the new helpers — `admin.generateLink({ type: 'magiclink' })` (unchanged) + `renderPasswordResetEmail` + `sendAuthEmail`. Net effect: same behavior, off Gmail, template in repo.

**Domain setup (in Resend dashboard, one-time):** Verify the sending domain (typically the same one used for app URLs), add SPF/DKIM/DMARC records to DNS, set up a no-reply or auth subdomain to isolate auth-email reputation from marketing if/when added.

### Login flow — single page, progressive reveal

`feportal/src/app/login/page.tsx` becomes a client component with two render states managed by local React state:

**State 1: Email entry**
- Email input + "Send sign-in code" button
- On submit, POST to `/api/auth/send-otp` with `{ email }`. The server route generates the code, sends the email, returns `{ success: true }`.
- Below the primary CTA: small text link "Use password instead" — only rendered during the 30-day transition window.

**State 2: Code entry**
- "Check your email" heading with the email obscured-but-recognizable: `a••@example.com`
- 6-digit code input (one box, single field — not 6 boxes — to keep paste behavior simple)
- "Verify" button → calls `supabase.auth.verifyOtp({ email, token, type: 'email' })` from the client
- Subtext: "or click the link in your email instead"
- "Resend code" link — disabled with countdown for 60 seconds after each send (calls `/api/auth/send-otp` again)
- "Use a different email" link → returns to State 1

**Magic-link landing:** Magic links sent in the OTP email point at `/auth/callback?code=...` (handled by the existing route). On success, redirect to dashboard. No new route needed.

**Password fallback (transition only):** Clicking "Use password instead" toggles a third local state with the existing password input + "Sign in" button calling `signInWithPassword()`. After the 30-day window, this code path is deleted along with the link.

### Invite flow change

Today: invite email → set-password page → set password → logged in.

New: invite email contains a magic link. Clicking it:
1. Hits `/auth/callback` (existing handler).
2. Supabase exchanges the token, sets the session.
3. User lands on the dashboard, already authenticated.

`feportal/src/app/auth/set-password/page.tsx` becomes a stub that redirects to `/login` (kept as a route for any in-flight invite links from before the migration; can be deleted after the 30-day transition).

The admin code that issues invites (already uses `supabase.auth.admin.generateLink()`) does not need to change — the link type stays `magiclink` / `invite`.

### Rate limiting and abuse

- **Server-side rate limit (5 sends per email per hour):** enforced in `/api/auth/send-otp` via a small `auth_otp_sends` table — `(email, sent_at)` rows; before each send, count rows for that email in the last hour and reject the 6th. Cleanup row older than 1 hour during each request. Tracks attempts even when the email doesn't exist (to mask enumeration).
- **Server-side cooldown (60 sec):** before sending, check the most recent `auth_otp_sends` row for the email; reject if < 60 sec ago. Same response shape returned to the client either way.
- **Client-side cooldown UI:** "Resend code" button shows a 60-sec countdown after each send for UX; the server is the source of truth.
- **Email enumeration:** `/api/auth/send-otp` always returns `{ success: true }`. If `admin.generateLink` errors because the user doesn't exist, the response is identical to a real send. The error is logged server-side but never surfaced.
- **Verify attempts (max 5):** Supabase Auth enforces this natively on `verifyOtp`.
- **TTL (10 min):** matches Supabase default for `type: 'email'` OTPs; no config change needed.

## Components changed

| File | Change |
|---|---|
| `feportal/src/lib/resend.ts` | **New** — exports memoized Resend client built from `RESEND_API_KEY` |
| `feportal/src/lib/emails/send.ts` | **New** — `sendAuthEmail({ to, subject, html })` chokepoint for Resend calls |
| `feportal/src/lib/emails/auth/sign-in-code.ts` | **New** — `renderSignInCodeEmail({ code, magicLink })` template |
| `feportal/src/lib/emails/auth/password-reset.ts` | **New** — `renderPasswordResetEmail({ link })` template (extracted from existing inline HTML) |
| `feportal/src/app/api/auth/send-otp/route.ts` | **New** — POST endpoint: generate code via admin API, send via Resend, enforce rate limits |
| `feportal/src/app/api/auth/forgot-password/route.ts` | **Migrate** — swap Nodemailer call for `sendAuthEmail` + new template helper; behavior unchanged |
| `feportal/src/app/login/page.tsx` | Rewrite as progressive-reveal OTP flow with password fallback link (transition only) |
| `feportal/src/app/auth/set-password/page.tsx` | Replace body with redirect to `/login` |
| `feportal/src/app/auth/callback/route.ts` | Already exists — verify it handles invite callbacks (it does, via `exchangeCodeForSession`); no change expected |
| `feportal/supabase/migrations/<dated>-auth-otp-sends.sql` | **New** — `auth_otp_sends` table for app-level rate limiting |
| Resend dashboard | Verify sending domain; add SPF/DKIM/DMARC records to DNS |
| `feportal/.env.local` / Vercel env | Confirm `RESEND_API_KEY` is present and valid in all environments |

## Phased rollout

Three sequential merges, each independently verifiable:

**Phase 1 — Resend foundation + password-reset migration (zero user-facing change)**
- Verify sending domain in Resend (DNS records).
- Add `src/lib/resend.ts`, `src/lib/emails/send.ts`, and `src/lib/emails/auth/password-reset.ts`.
- Rewrite `forgot-password/route.ts` to use the new helpers instead of Nodemailer.
- Trigger a real password-reset email to a test account; confirm it arrives from Resend, renders correctly, and the reset link works end-to-end.
- **Reversible:** revert the route commit; the rest of the helpers are dead code until Phase 2.

**Phase 2 — Passwordless login UI + send-otp route**
- Add `src/lib/emails/auth/sign-in-code.ts`.
- Add `src/app/api/auth/send-otp/route.ts` + the `auth_otp_sends` migration.
- Rewrite `src/app/login/page.tsx` as progressive-reveal OTP flow with password fallback link.
- End-to-end test: code email arrives, code verifies, magic link works, password fallback works.
- **Reversible:** revert the login page + send-otp route commit; password login keeps working.

**Phase 3 — Invite flow + 30-day cleanup (two sub-commits)**
- 3a (now): Update invite flow so the invite email points at `/auth/callback` directly (auto-login); stub `set-password/page.tsx` as a redirect to `/login`.
- 3b (in 30 days, separate PR): Remove password fallback link from login. Delete `set-password/page.tsx`, the password input branch, and any `signInWithPassword` calls. Optionally null-out password hashes in `auth.users` for users who've successfully logged in via OTP since Phase 2.

## Security review checkpoints

(Per workflow guidance for production-sensitive surfaces — auth.)

- Confirm `shouldCreateUser: false` is set, preventing drive-by account creation.
- Confirm error responses are masked (no email-existence enumeration).
- Confirm Resend domain is properly verified (SPF, DKIM, DMARC records in DNS).
- Confirm Supabase RLS policies on `auth.users` are unchanged.
- Confirm session cookie attributes (httpOnly, secure, sameSite) unchanged from current setup.
- Confirm `/auth/callback` route validates the token via Supabase (does not trust query params).
- Phase 5 of workflow will invoke `security-review` skill on the final diff.

## Verification (Phase 6 of workflow)

End-to-end via Playwright MCP against the dev server:
1. New session → /login → enter email → receive code → enter code → land on dashboard.
2. New session → /login → enter email → click magic link in email → land on dashboard.
3. New session → /login → "Use password instead" → enter password → land on dashboard. (Transition-window only.)
4. New session → /login → enter email → wait 11 minutes → code is rejected as expired.
5. New session → /login → enter email → enter wrong code 5 times → 6th attempt rejected without retry.
6. New session → /login → enter unregistered email → see "Check your email" message (no enumeration).
7. New invite via admin → click invite link → auto-logged in.

## Open risks

1. **Email deliverability during Resend warmup.** Mitigated by verifying domain ahead of Phase 1 and starting with low-volume password-reset traffic before passwordless launch.
2. **Users on slow corporate email scanners** may have magic links pre-fetched/invalidated. Mitigated by offering OTP code as alternative on the same screen.
3. **Existing in-flight invite emails** (sent before Phase 3 deploy) will land on the redirect-to-login page. Acceptable — they can sign in passwordlessly with their email. Documented in the release notes.
