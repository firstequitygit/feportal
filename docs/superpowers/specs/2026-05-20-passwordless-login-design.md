# Passwordless Login Migration — Design

**Date:** 2026-05-20
**Status:** Draft, pending approval
**Scope:** FE-Portal (Next.js 16, Supabase Auth, app router)

## Goal

Replace password-based login with passwordless email authentication (6-digit OTP code *or* magic link, user's choice). Migrate transactional email delivery from Gmail SMTP to Resend along the way. Maintain a 30-day transition window where existing users can still sign in with their old password as an escape hatch.

## Non-goals

- Adding social/OAuth login (separate effort, not blocked by this work).
- Migrating long-running transactional emails (`sendStageUpdateEmail`, etc.) off Nodemailer in this work. We swap Supabase Auth's SMTP only. Application-level emails can be migrated later in a separate effort — they will continue to use Gmail SMTP via Nodemailer until then.
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
| Email provider | Resend (configured as Supabase Auth custom SMTP) |

## Architecture

### Email delivery — Resend as Supabase Auth SMTP

Supabase Auth sends all its own emails (OTP codes, magic links, password reset, invites). It supports custom SMTP via the project settings. We point it at Resend:

- Host: `smtp.resend.com`
- Port: `465` (SSL)
- Username: `resend`
- Password: `RESEND_API_KEY` (project env var)
- Sender: `auth@<verified-domain>` — domain verified in Resend dashboard

**The app code does not call Resend directly for auth emails.** Supabase handles all auth email rendering and delivery once SMTP is configured. We only customize the Supabase email templates (in dashboard) to match brand voice.

The existing Nodemailer-based `lib/email.ts` transactional emails are out of scope and continue to use Gmail SMTP until a follow-up migration.

### Login flow — single page, progressive reveal

`feportal/src/app/login/page.tsx` becomes a client component with two render states managed by local React state:

**State 1: Email entry**
- Email input + "Send sign-in code" button
- Calls `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })`. Supabase sends an email containing **both** the 6-digit code and a magic-link button (template customized to show both).
- Below the primary CTA: small text link "Use password instead" — only rendered during the 30-day transition window.

**State 2: Code entry**
- "Check your email" heading with the email obscured-but-recognizable: `a••@example.com`
- 6-digit code input (one box, single field — not 6 boxes — to keep paste behavior simple)
- "Verify" button → calls `supabase.auth.verifyOtp({ email, token, type: 'email' })`
- Subtext: "or click the link in your email instead"
- "Resend code" link — disabled with countdown for 60 seconds after each send
- "Use a different email" link → returns to State 1

**Magic-link landing:** Supabase's magic-link clicks redirect to `/auth/callback` (already exists for the existing magic-link flows). On success, redirect to dashboard. No new route needed.

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

- Supabase Auth enforces server-side rate limits on `signInWithOtp` (default 30 emails/hour per project; configurable in dashboard).
- **App-level cooldown (60-sec resend):** enforced client-side by disabling the button + countdown. Sufficient because the server-side Supabase limits backstop it.
- **Email enumeration:** `shouldCreateUser: false` means Supabase returns an error if the email isn't registered. We mask this in the UI: always show "Check your email" regardless. The error is logged server-side via the Supabase response but never surfaced to the user.
- **Verify attempts (max 5):** Supabase Auth enforces this natively.
- **TTL (10 min):** matches Supabase default; no config change needed.

## Components changed

| File | Change |
|---|---|
| `feportal/src/app/login/page.tsx` | Rewrite as progressive-reveal OTP flow with password fallback link (transition only) |
| `feportal/src/app/auth/set-password/page.tsx` | Replace body with redirect to `/login` |
| `feportal/src/app/auth/callback/route.ts` | Already exists — verify it handles both OTP magic-link callbacks and invite callbacks; extend if needed |
| Supabase dashboard | Configure custom SMTP (Resend) + customize OTP/magic-link email templates |
| Resend dashboard | Verify sending domain |
| `feportal/.env.local` / Vercel env | Add `RESEND_API_KEY` (already in env per inventory) — confirm present |

## Phased rollout

Three sequential merges, each independently verifiable:

**Phase 1 — Resend SMTP swap (zero user-facing change)**
- Verify domain in Resend.
- Configure Supabase Auth custom SMTP → Resend.
- Trigger an existing password-reset email to a test account; confirm it arrives from Resend and renders correctly.
- Verify dashboard logs in Resend show the send.
- **Reversible:** revert SMTP config in Supabase dashboard.

**Phase 2 — Passwordless login UI**
- Rewrite `login/page.tsx`.
- Customize Supabase OTP email template to show both code and magic link.
- End-to-end test: new email arrives, code works, magic link works, fallback password works.
- **Reversible:** revert the login page commit; Supabase still sends OTPs but no UI exposes them.

**Phase 3 — Invite flow + 30-day cleanup (this is two sub-commits in one phase)**
- 3a (now): Convert invite to magic-link → auto-login. Stub set-password page.
- 3b (in 30 days, separate PR): Remove password fallback link from login. Delete `set-password/page.tsx`, the password input branch, and any `signInWithPassword` calls.

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
