# Passwordless Login Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace password-based login on FE-Portal with passwordless email auth (6-digit OTP code + magic link), and migrate all auth emails off Gmail/Nodemailer onto Resend with branded templates in the repo. Maintain a 30-day window where existing users can still log in with their old password.

**Architecture:** Use the existing `forgot-password` pattern — generate codes/links via `adminClient.auth.admin.generateLink()`, send via Resend SDK from Next.js API routes, with branded HTML templates living in `src/lib/emails/auth/`. App-level rate limiting via a new `auth_otp_sends` table.

**Tech Stack:** Next.js 16 (App Router) · TypeScript · Supabase Auth · Resend SDK (`resend@6.12.2`, already installed) · shadcn/ui · Tailwind v4. No automated test framework — `npm run build` is the correctness check, Playwright MCP for E2E.

**Branch:** `feature/passwordless-login` (already pushed to origin).

**Spec:** `docs/superpowers/specs/2026-05-20-passwordless-login-design.md`

---

## Pre-flight (manual — do before Task 1.1)

These are out-of-code prerequisites that block deployment but don't generate commits. Do them in the Resend and Supabase dashboards.

- [ ] **P1: Resend domain verification**
  - Log in to Resend dashboard, add the sending domain (typically `fefunding.com` or `auth.fefunding.com`).
  - Add the four DNS records Resend provides (1× MX or `_resend` TXT, 2× DKIM CNAMEs, 1× SPF TXT) to your DNS provider.
  - Wait for verification to succeed in Resend (usually < 30 min).
  - Decide on the `From` address — recommended: `First Equity Funding <auth@<verified-domain>>`.

- [ ] **P2: Confirm `RESEND_API_KEY`**
  - Check `.env.local` for `RESEND_API_KEY=re_…`. If missing, generate in Resend dashboard.
  - Confirm the same key is present in Vercel project env vars (Settings → Environment Variables, scoped to Production + Preview + Development).

- [ ] **P3: Decide the `From` address**
  - Capture as a new env var: `AUTH_EMAIL_FROM="First Equity Funding <auth@fefunding.com>"`.
  - Add it locally to `.env.local` and to Vercel env vars (all three scopes).

---

## Phase 1 — Resend foundation + password-reset migration

**Scope:** Zero user-facing change. Swap the existing password-reset email from Nodemailer/Gmail to Resend. Build the helpers that Phase 2 will also use. After Phase 1, all auth emails are off Gmail.

**Parallel-safe tasks:** 1.1, 1.2, 1.3 touch only new files and can be run by independent subagents in parallel.

### Task 1.1: Create Resend client wrapper

**Files:**
- Create: `feportal/src/lib/resend.ts`

- [ ] **Step 1: Write the file**

```ts
import { Resend } from 'resend'

let cached: Resend | null = null

export function getResend(): Resend {
  if (cached) return cached
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('RESEND_API_KEY is not configured')
  cached = new Resend(key)
  return cached
}
```

- [ ] **Step 2: Verify the file builds**

Run from `c:\Users\apalm\FE-Portal\feportal`:
```
npm run build
```
Expected: Build passes. (The file is unused at this point — confirms the import is well-typed.)

- [ ] **Step 3: Commit**

```
git add src/lib/resend.ts
git commit -m "feat(auth): add Resend client wrapper"
```

---

### Task 1.2: Create auth-email send helper

**Files:**
- Create: `feportal/src/lib/emails/send.ts`

- [ ] **Step 1: Write the file**

```ts
import { getResend } from '@/lib/resend'

const FROM = process.env.AUTH_EMAIL_FROM ?? 'First Equity Funding <auth@fefunding.com>'

export type AuthEmail = {
  to: string
  subject: string
  html: string
}

/**
 * Single chokepoint for all auth-related transactional emails.
 * Logs Resend errors server-side but never throws — callers should treat
 * the operation as best-effort and respond identically to the client
 * regardless of outcome (to prevent enumeration in flows like send-otp).
 */
export async function sendAuthEmail({ to, subject, html }: AuthEmail): Promise<{ id: string | null }> {
  const resend = getResend()
  const { data, error } = await resend.emails.send({ from: FROM, to, subject, html })
  if (error) {
    console.error('[sendAuthEmail] Resend error:', error)
    return { id: null }
  }
  return { id: data?.id ?? null }
}
```

- [ ] **Step 2: Verify the file builds**

Run from `c:\Users\apalm\FE-Portal\feportal`:
```
npm run build
```
Expected: Build passes.

- [ ] **Step 3: Commit**

```
git add src/lib/emails/send.ts
git commit -m "feat(auth): add sendAuthEmail helper as Resend chokepoint"
```

---

### Task 1.3: Extract password-reset email template

**Files:**
- Create: `feportal/src/lib/emails/auth/password-reset.ts`

**Purpose:** Move the inline HTML from `forgot-password/route.ts` (lines 35-50) into a versionable template helper. No visual change — same HTML, just relocated.

- [ ] **Step 1: Write the file**

```ts
export type PasswordResetEmail = {
  /** The absolute action link generated by adminClient.auth.admin.generateLink. */
  link: string
}

export function renderPasswordResetEmail({ link }: PasswordResetEmail): { subject: string; html: string } {
  const subject = 'Reset your First Equity Funding Portal password'
  const html = `
    <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">Hi,</p>
    <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
      We received a request to reset the password for your <strong>First Equity Funding Online Portal</strong> account.
      Click the button below to set a new password.
    </p>
    <p style="margin-top: 24px;">
      <a href="${link}" style="background-color: #1F5D8F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-family: Arial, sans-serif; font-size: 14px; font-weight: bold;">
        Reset Password
      </a>
    </p>
    <p style="font-family: Arial, sans-serif; font-size: 12px; color: #999; margin-top: 24px;">
      This link expires in 24 hours. If you didn't request a password reset, you can safely ignore this email.
    </p>
    <p style="font-family: Arial, sans-serif; font-size: 12px; color: #999;">First Equity Funding Online Portal</p>
  `
  return { subject, html }
}
```

- [ ] **Step 2: Verify the file builds**

Run from `c:\Users\apalm\FE-Portal\feportal`:
```
npm run build
```
Expected: Build passes.

- [ ] **Step 3: Commit**

```
git add src/lib/emails/auth/password-reset.ts
git commit -m "feat(auth): extract password-reset email template into helper"
```

---

### Task 1.4: Migrate `forgot-password` route to Resend

**Files:**
- Modify: `feportal/src/app/api/auth/forgot-password/route.ts`

**Depends on:** 1.1, 1.2, 1.3.

- [ ] **Step 1: Replace the entire file with this content**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendAuthEmail } from '@/lib/emails/send'
import { renderPasswordResetEmail } from '@/lib/emails/auth/password-reset'
import { PORTAL_URL } from '@/lib/portal-url'

const REDIRECT = `${PORTAL_URL}/auth/set-password`

export async function POST(req: NextRequest) {
  const { email } = await req.json()
  if (!email) return NextResponse.json({ error: 'Email is required' }, { status: 400 })

  const adminClient = createAdminClient()

  const { data, error } = await adminClient.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: REDIRECT },
  })

  if (error || !data) {
    // Don't leak whether the email exists — always return success.
    console.error('[forgot-password] generateLink error:', error?.message)
    return NextResponse.json({ success: true })
  }

  const { subject, html } = renderPasswordResetEmail({ link: data.properties.action_link })
  await sendAuthEmail({ to: email, subject, html })

  return NextResponse.json({ success: true })
}
```

- [ ] **Step 2: Verify the file builds**

Run from `c:\Users\apalm\FE-Portal\feportal`:
```
npm run build
```
Expected: Build passes. ESLint may flag unused imports — confirm none remain (`nodemailer` should be gone from this file).

- [ ] **Step 3: Manual end-to-end verification**

1. Start dev server: `npm run dev`.
2. Open `http://localhost:3000/auth/forgot-password` in a private browser window.
3. Enter the email of a known test account (one you have inbox access to).
4. Click "Send reset link".
5. Within ~30 seconds, the password-reset email should arrive **from `auth@<verified-domain>` via Resend** (not Gmail).
6. Open the email; the styling should match the previous Gmail version exactly (button color, layout, copy).
7. Click the reset button; you should land on `/auth/set-password` and be able to set a new password.
8. Verify the Resend dashboard shows this send under Emails → Recent.

If the email doesn't arrive: check Resend dashboard for delivery status, check Supabase Auth logs, confirm `RESEND_API_KEY` and `AUTH_EMAIL_FROM` are present in `.env.local`.

- [ ] **Step 4: Commit**

```
git add src/app/api/auth/forgot-password/route.ts
git commit -m "feat(auth): migrate forgot-password route from Nodemailer to Resend"
```

---

### Task 1.5: Phase 1 wrap-up

- [ ] **Step 1: Push branch to origin**

```
git push origin feature/passwordless-login
```

- [ ] **Step 2: User checkpoint**

Surface to the user: "Phase 1 complete. Password-reset email is now off Gmail and on Resend with template in repo. Verify in the Resend dashboard that the test email landed, then approve Phase 2."

---

## Phase 2 — Passwordless login UI + send-otp API

**Scope:** Build the new OTP send endpoint, the OTP email template, the rate-limit migration, and rewrite the login page as a progressive-reveal OTP/magic-link flow with a password fallback link.

**Parallel-safe tasks:** 2.1, 2.2, 2.3 touch independent files.

### Task 2.1: Database migration for OTP rate-limit tracking

**Files:**
- Create: `feportal/supabase/migrations/20260520-auth-otp-sends.sql`

- [ ] **Step 1: Write the file**

```sql
-- Track each /api/auth/send-otp call so the server can enforce a 60-sec
-- cooldown and a per-email-per-hour cap. Cleanup runs inline on each
-- request (delete rows older than 1 hour for the requesting email).

create table if not exists public.auth_otp_sends (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  sent_at timestamptz not null default now()
);

create index if not exists auth_otp_sends_email_sent_at_idx
  on public.auth_otp_sends (email, sent_at desc);

-- Service-role-only; no RLS exposure to anon/authenticated clients.
alter table public.auth_otp_sends enable row level security;
```

- [ ] **Step 2: Apply the migration locally**

Run from `c:\Users\apalm\FE-Portal\feportal`:
```
npx supabase db push
```
Expected: Migration applies cleanly. Confirm with:
```
npx supabase db psql -c "select count(*) from public.auth_otp_sends;"
```
Expected: returns `0`.

- [ ] **Step 3: Commit**

```
git add supabase/migrations/20260520-auth-otp-sends.sql
git commit -m "feat(auth): add auth_otp_sends table for OTP rate limiting"
```

---

### Task 2.2: OTP email template

**Files:**
- Create: `feportal/src/lib/emails/auth/sign-in-code.ts`

- [ ] **Step 1: Write the file**

```ts
export type SignInCodeEmail = {
  /** The 6-digit code from adminClient.auth.admin.generateLink properties.email_otp */
  code: string
  /** The magic-link URL from adminClient.auth.admin.generateLink properties.action_link */
  magicLink: string
}

export function renderSignInCodeEmail({ code, magicLink }: SignInCodeEmail): { subject: string; html: string } {
  const subject = 'Your First Equity Funding sign-in code'
  const html = `
    <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">Hi,</p>
    <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
      Use the code below to sign in to your <strong>First Equity Funding Online Portal</strong> account.
    </p>
    <div style="margin: 24px 0; padding: 20px; background-color: #F4F7FB; border: 1px solid #DDE6EF; border-radius: 8px; text-align: center;">
      <div style="font-family: 'Courier New', Courier, monospace; font-size: 32px; font-weight: bold; color: #1F5D8F; letter-spacing: 8px;">
        ${code}
      </div>
    </div>
    <p style="font-family: Arial, sans-serif; font-size: 14px; color: #555;">
      Or click the button to sign in directly:
    </p>
    <p style="margin-top: 12px;">
      <a href="${magicLink}" style="background-color: #1F5D8F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-family: Arial, sans-serif; font-size: 14px; font-weight: bold;">
        Sign in
      </a>
    </p>
    <p style="font-family: Arial, sans-serif; font-size: 12px; color: #999; margin-top: 24px;">
      This code and link expire in 10 minutes. If you didn't request this, you can safely ignore this email.
    </p>
    <p style="font-family: Arial, sans-serif; font-size: 12px; color: #999;">First Equity Funding Online Portal</p>
  `
  return { subject, html }
}
```

- [ ] **Step 2: Verify the file builds**

```
npm run build
```
Expected: Build passes.

- [ ] **Step 3: Commit**

```
git add src/lib/emails/auth/sign-in-code.ts
git commit -m "feat(auth): add sign-in-code email template"
```

---

### Task 2.3: `/api/auth/send-otp` route

**Files:**
- Create: `feportal/src/app/api/auth/send-otp/route.ts`

**Depends on:** 2.1 (migration applied), 2.2 (template), 1.1, 1.2 (Resend helpers).

- [ ] **Step 1: Write the file**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendAuthEmail } from '@/lib/emails/send'
import { renderSignInCodeEmail } from '@/lib/emails/auth/sign-in-code'

const COOLDOWN_MS = 60_000           // 60 seconds between sends for same email
const HOURLY_CAP = 5                 // max 5 sends per email per rolling hour

export async function POST(req: NextRequest) {
  const { email } = await req.json()

  // Basic shape check — keep it loose; we'll always return success to the client.
  if (typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ success: true })
  }
  const normalized = email.trim().toLowerCase()

  const adminClient = createAdminClient()

  // 1. Rate-limit checks (server-side; client UI is decorative).
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const cooldownAgo = new Date(Date.now() - COOLDOWN_MS).toISOString()

  const { data: recent } = await adminClient
    .from('auth_otp_sends')
    .select('sent_at')
    .eq('email', normalized)
    .gte('sent_at', hourAgo)
    .order('sent_at', { ascending: false })

  if (recent && recent.length >= HOURLY_CAP) {
    // Silently swallow — caller sees identical "success" response.
    console.warn('[send-otp] hourly cap hit for', normalized)
    return NextResponse.json({ success: true })
  }
  if (recent && recent[0] && recent[0].sent_at > cooldownAgo) {
    // Cooldown window — also swallow.
    console.warn('[send-otp] cooldown active for', normalized)
    return NextResponse.json({ success: true })
  }

  // 2. Generate code + magic link via admin API.
  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: 'email',
    email: normalized,
  })

  if (linkError || !linkData?.properties?.email_otp || !linkData?.properties?.action_link) {
    // User likely doesn't exist. Log and return success (no enumeration).
    console.error('[send-otp] generateLink error:', linkError?.message)
    // Still record the attempt for rate limiting, so attackers can't probe for emails by flooding.
    await adminClient.from('auth_otp_sends').insert({ email: normalized })
    return NextResponse.json({ success: true })
  }

  // 3. Send email via Resend.
  const { subject, html } = renderSignInCodeEmail({
    code: linkData.properties.email_otp,
    magicLink: linkData.properties.action_link,
  })
  await sendAuthEmail({ to: normalized, subject, html })

  // 4. Record the send.
  await adminClient.from('auth_otp_sends').insert({ email: normalized })

  return NextResponse.json({ success: true })
}
```

- [ ] **Step 2: Verify the file builds**

```
npm run build
```
Expected: Build passes.

- [ ] **Step 3: Smoke test the route**

Start dev server (`npm run dev`), then in a separate terminal:
```
curl -X POST http://localhost:3000/api/auth/send-otp -H "Content-Type: application/json" -d "{\"email\":\"<your-test-email>\"}"
```
Expected: `{"success":true}`. A sign-in-code email arrives within ~30 sec.

Then immediately repeat the same curl — confirm a second email does NOT arrive (60-sec cooldown is enforced).

- [ ] **Step 4: Commit**

```
git add src/app/api/auth/send-otp/route.ts
git commit -m "feat(auth): add /api/auth/send-otp endpoint with rate limiting"
```

---

### Task 2.4: Rewrite the login page

**Files:**
- Modify (full rewrite): `feportal/src/app/login/page.tsx`

**Depends on:** 2.3 (route must exist before the UI can call it).

- [ ] **Step 1: Replace the file with this content**

```tsx
'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const RESEND_COOLDOWN_SEC = 60
const SHOW_PASSWORD_FALLBACK_UNTIL = new Date('2026-06-19') // 30 days from 2026-05-20 launch

type Mode = 'email' | 'code' | 'password'

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return email
  if (local.length <= 2) return `${local[0]}••@${domain}`
  return `${local[0]}${'•'.repeat(Math.max(2, local.length - 2))}${local.slice(-1)}@${domain}`
}

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()

  const [mode, setMode] = useState<Mode>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const showPasswordFallback = new Date() < SHOW_PASSWORD_FALLBACK_UNTIL

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN_SEC)
    if (cooldownTimer.current) clearInterval(cooldownTimer.current)
    cooldownTimer.current = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1 && cooldownTimer.current) {
          clearInterval(cooldownTimer.current)
          cooldownTimer.current = null
        }
        return Math.max(0, s - 1)
      })
    }, 1000)
  }

  useEffect(() => {
    return () => {
      if (cooldownTimer.current) clearInterval(cooldownTimer.current)
    }
  }, [])

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
    } finally {
      setLoading(false)
    }
    setMode('code')
    startCooldown()
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: 'email',
    })

    if (verifyError) {
      setError('That code is invalid or expired. Try again or request a new one.')
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  async function handleResend() {
    if (cooldown > 0) return
    await fetch('/api/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    startCooldown()
  }

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })

    if (signInError) {
      setError('Invalid email or password. Please try again.')
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#ffffff' }}>
      <div className="w-full py-4 px-6" style={{ backgroundColor: '#ffffff' }}>
        <Image src="/logo-symbol.png" alt="First Equity Funding" width={36} height={36} className="h-8 w-auto" />
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <Image src="/logo-main.png" alt="First Equity Funding" width={724} height={86} className="h-20 w-auto mx-auto mb-3" />
          </div>

          <Card>
            {mode === 'email' && (
              <>
                <CardHeader>
                  <CardTitle>Sign in to your account</CardTitle>
                  <CardDescription>Enter your email and we'll send you a sign-in code.</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSendCode} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="email">Email address</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoComplete="email"
                      />
                    </div>
                    {error && (
                      <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>
                    )}
                    <Button type="submit" className="w-full" disabled={loading}>
                      {loading ? 'Sending…' : 'Send sign-in code'}
                    </Button>
                  </form>

                  {showPasswordFallback && (
                    <div className="text-center mt-4">
                      <button
                        type="button"
                        onClick={() => { setMode('password'); setError('') }}
                        className="text-sm text-primary hover:opacity-80"
                      >
                        Use password instead
                      </button>
                    </div>
                  )}

                  <p className="text-sm text-gray-500 text-center mt-4">
                    Need access? Contact your loan officer to receive an invitation.
                  </p>
                </CardContent>
              </>
            )}

            {mode === 'code' && (
              <>
                <CardHeader>
                  <CardTitle>Check your email</CardTitle>
                  <CardDescription>
                    We sent a 6-digit code to <strong>{maskEmail(email)}</strong>. Enter it below or click the link in the email.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleVerifyCode} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="code">Sign-in code</Label>
                      <Input
                        id="code"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        autoComplete="one-time-code"
                        placeholder="123456"
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        required
                        autoFocus
                      />
                    </div>
                    {error && (
                      <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>
                    )}
                    <Button type="submit" className="w-full" disabled={loading || code.length !== 6}>
                      {loading ? 'Verifying…' : 'Verify'}
                    </Button>
                  </form>

                  <div className="text-center mt-4 space-y-1">
                    <button
                      type="button"
                      onClick={handleResend}
                      disabled={cooldown > 0}
                      className="text-sm text-primary hover:opacity-80 disabled:opacity-50"
                    >
                      {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
                    </button>
                    <div>
                      <button
                        type="button"
                        onClick={() => { setMode('email'); setCode(''); setError('') }}
                        className="text-sm text-gray-500 hover:opacity-80"
                      >
                        Use a different email
                      </button>
                    </div>
                  </div>
                </CardContent>
              </>
            )}

            {mode === 'password' && (
              <>
                <CardHeader>
                  <CardTitle>Sign in with password</CardTitle>
                  <CardDescription>You can use your existing password to sign in.</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handlePasswordLogin} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="email-pw">Email address</Label>
                      <Input
                        id="email-pw"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoComplete="email"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="password">Password</Label>
                      <Input
                        id="password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        autoComplete="current-password"
                      />
                    </div>
                    {error && (
                      <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>
                    )}
                    <Button type="submit" className="w-full" disabled={loading}>
                      {loading ? 'Signing in…' : 'Sign in'}
                    </Button>
                  </form>

                  <div className="text-center mt-4 space-y-1">
                    <button
                      type="button"
                      onClick={() => { setMode('email'); setError('') }}
                      className="text-sm text-primary hover:opacity-80"
                    >
                      ← Use a sign-in code instead
                    </button>
                    <div>
                      <a href="/auth/forgot-password" className="text-sm text-gray-500 hover:opacity-80">
                        Forgot your password?
                      </a>
                    </div>
                  </div>
                </CardContent>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify the file builds**

```
npm run build
```
Expected: Build passes.

- [ ] **Step 3: Manual end-to-end verification (dev server)**

Start dev server (`npm run dev`), open `http://localhost:3000/login` in a private window, and walk through these scenarios using a real test account email you can read:

1. **OTP code path:** Enter email → click "Send sign-in code" → check inbox → enter 6-digit code → land on `/dashboard`. ✅
2. **Magic-link path:** From a fresh private window, enter same email → check inbox → click "Sign in" button in the email → land on `/dashboard` directly. ✅
3. **Password fallback:** From `/login`, click "Use password instead" → enter email + password → land on `/dashboard`. ✅
4. **Resend cooldown:** On the code screen, immediately click "Resend code" — should be disabled with countdown. After 60 sec, becomes clickable again. ✅
5. **Wrong code:** Enter 6 random digits → "That code is invalid or expired." error. ✅
6. **Unregistered email:** Enter `notanaccount@example.com` → still see "Check your email" message (no enumeration). No email arrives, but the UI flow is identical. ✅
7. **Use a different email:** From code screen, click "Use a different email" → returns to email step with form cleared. ✅

If any scenario fails: do not commit. Diagnose with the systematic-debugging skill.

- [ ] **Step 4: Commit**

```
git add src/app/login/page.tsx
git commit -m "feat(auth): rewrite login page as passwordless OTP + magic link with password fallback"
```

---

### Task 2.5: Phase 2 wrap-up

- [ ] **Step 1: Push branch**

```
git push origin feature/passwordless-login
```

- [ ] **Step 2: User checkpoint**

Surface to the user: "Phase 2 complete. New login flow live in dev. All 7 verification scenarios passed. Approve to proceed to Phase 3 (invite-flow change)."

---

## Phase 3 — Invite flow change + set-password stub

**Scope:** Six invite-issuing routes currently send invite links pointing at `/auth/set-password` or `/auth/welcome`. After this phase, those links point at `/auth/callback?next=/dashboard` (which exchanges the code and logs the user in directly). The set-password and welcome pages become redirect stubs.

### Task 3.1: Audit all invite redirectTo URLs

**Files (read-only audit):**
- `feportal/src/lib/invite-broker.ts` line ~85
- `feportal/src/lib/invite-borrower.ts` line ~71
- `feportal/src/app/api/admin/underwriters/invite/route.ts` lines ~7, 32, 39
- `feportal/src/app/api/admin/loan-officers/invite/route.ts` lines ~7, 33, 41
- `feportal/src/app/api/admin/loan-processors/invite/route.ts` lines ~7, 32, 39

- [ ] **Step 1: Confirm the audit table**

Run from `c:\Users\apalm\FE-Portal\feportal`:
```
git grep -n "redirectTo" src/lib/invite-borrower.ts src/lib/invite-broker.ts src/app/api/admin/underwriters/invite/route.ts src/app/api/admin/loan-officers/invite/route.ts src/app/api/admin/loan-processors/invite/route.ts
```
Expected: 8 hits total. Confirm each one points to either `/auth/set-password` or `/auth/welcome` today.

If the count or paths differ from the spec, STOP and resync with the user before editing.

---

### Task 3.2: Update all invite redirects to `/auth/callback`

**Files:**
- Modify: `feportal/src/lib/invite-borrower.ts` (line ~71)
- Modify: `feportal/src/lib/invite-broker.ts` (line ~85)
- Modify: `feportal/src/app/api/admin/underwriters/invite/route.ts` (lines ~7, 32, 39)
- Modify: `feportal/src/app/api/admin/loan-officers/invite/route.ts` (lines ~7, 33, 41)
- Modify: `feportal/src/app/api/admin/loan-processors/invite/route.ts` (lines ~7, 32, 39)

- [ ] **Step 1: In each admin staff invite route (underwriters / loan-officers / loan-processors), replace the constant**

OLD:
```ts
const REDIRECT = `${PORTAL_URL}/auth/set-password`
```
NEW:
```ts
const REDIRECT = `${PORTAL_URL}/auth/callback?next=/dashboard`
```

Apply to all three files: `src/app/api/admin/underwriters/invite/route.ts`, `src/app/api/admin/loan-officers/invite/route.ts`, `src/app/api/admin/loan-processors/invite/route.ts`.

- [ ] **Step 2: In `src/lib/invite-borrower.ts`, change the redirectTo option**

OLD (line ~71):
```ts
    options: { redirectTo: `${PORTAL_URL}/auth/welcome` },
```
NEW:
```ts
    options: { redirectTo: `${PORTAL_URL}/auth/callback?next=/dashboard` },
```

- [ ] **Step 3: In `src/lib/invite-broker.ts`, change the redirectTo option**

OLD (line ~85):
```ts
    options: { redirectTo: `${PORTAL_URL}/auth/welcome` },
```
NEW:
```ts
    options: { redirectTo: `${PORTAL_URL}/auth/callback?next=/dashboard` },
```

- [ ] **Step 4: Verify the build**

```
npm run build
```
Expected: Build passes.

- [ ] **Step 5: Commit**

```
git add src/lib/invite-borrower.ts src/lib/invite-broker.ts \
  src/app/api/admin/underwriters/invite/route.ts \
  src/app/api/admin/loan-officers/invite/route.ts \
  src/app/api/admin/loan-processors/invite/route.ts
git commit -m "feat(auth): point invite links at /auth/callback for direct sign-in"
```

---

### Task 3.3: Stub `set-password` and `welcome` pages

**Files:**
- Modify (full replace): `feportal/src/app/auth/set-password/page.tsx`
- Modify (full replace): `feportal/src/app/auth/welcome/page.tsx`

**Why stub instead of delete?** In-flight invite emails sent before this phase deploys still point to these URLs. The stub gives those users a graceful redirect to `/login` so they can sign in passwordlessly with the email that received the invite.

- [ ] **Step 1: Replace `set-password/page.tsx` with this**

```tsx
import { redirect } from 'next/navigation'

export default function SetPasswordPage() {
  // Legacy invite endpoint. Direct sign-in is now via /auth/callback;
  // any users who land here from old invite emails get redirected to login.
  redirect('/login')
}
```

- [ ] **Step 2: Replace `welcome/page.tsx` with the same stub content**

```tsx
import { redirect } from 'next/navigation'

export default function WelcomePage() {
  // Legacy invite endpoint. Direct sign-in is now via /auth/callback;
  // any users who land here from old invite emails get redirected to login.
  redirect('/login')
}
```

- [ ] **Step 3: Verify the build**

```
npm run build
```
Expected: Build passes.

- [ ] **Step 4: Commit**

```
git add src/app/auth/set-password/page.tsx src/app/auth/welcome/page.tsx
git commit -m "feat(auth): stub set-password and welcome pages as redirects to /login"
```

---

### Task 3.4: End-to-end verification of invite flow

- [ ] **Step 1: Manual test of staff invite (admin → loan officer)**

Pre-req: Be logged in as an admin in dev.

1. Open `http://localhost:3000/admin` (or the loan-officers manager UI).
2. Invite a new loan officer using a test email you control.
3. Check the inbox; invite email should arrive (still from Gmail until lib/email.ts is migrated, but that's out of scope).
4. Click the invite link in the email.
5. Expected: land on `/dashboard` already signed in, with NO password-setting step.

- [ ] **Step 2: Manual test of borrower invite**

Same flow via the appropriate UI; expected behavior identical.

- [ ] **Step 3: Manual test of in-flight legacy invite handling**

In a private browser, navigate to `http://localhost:3000/auth/set-password` directly. Expected: instant redirect to `/login`. Do the same for `/auth/welcome`.

If any test fails: do not push. Diagnose.

---

### Task 3.5: Phase 3 wrap-up

- [ ] **Step 1: Push branch**

```
git push origin feature/passwordless-login
```

- [ ] **Step 2: User checkpoint**

Surface to the user: "Phase 3 complete. Invite flow now auto-logs users in. Set-password and welcome pages stubbed. Ready for the workflow Phase 5 (security review) + Phase 6 (Playwright end-to-end) before merge."

---

## Workflow Phase 5 — Security review

(Per the workflow skill rule that auth changes trigger `security-review`.)

- [ ] **Step 1: Invoke security-review skill on the branch diff**

Surface to the orchestrator: "Phase 5 of workflow — invoke `security-review` against branch `feature/passwordless-login` (diff vs `main`). Focus on the auth surface."

Review the report. Expected red flags to confirm-or-explain:
- `/api/auth/send-otp` swallows generateLink errors — confirm this is intentional (anti-enumeration).
- `/api/auth/send-otp` records a row even when the user doesn't exist — confirm this is intentional (so rate limits also throttle probing).
- Password fallback still exposes `signInWithPassword` for 30 days — confirm the cutoff date is correct.
- `auth_otp_sends` table has no RLS policy beyond "enable RLS" — confirm only service role accesses it (correct per design).

Address anything else the reviewer flags before proceeding.

---

## Workflow Phase 6 — Final Playwright verification

- [ ] **Step 1: Use Playwright MCP to drive the full flow**

With dev server running, use `mcp__plugin_playwright_playwright__browser_*` tools to walk through these 7 scenarios from the spec. Capture screenshots of each successful state for the verification gate:

1. New session → /login → enter email → receive code → enter code → land on dashboard.
2. New session → /login → enter email → click magic link in email → land on dashboard. (Note: Playwright can't open the real inbox; this requires reading the latest Resend send via dashboard or hitting `/api/auth/send-otp` and extracting the link from server logs.)
3. New session → /login → "Use password instead" → enter password → land on dashboard.
4. New session → /login → enter email → wait 11 minutes → code is rejected as expired.
5. New session → /login → enter email → enter wrong code 5 times → 6th attempt rejected without retry.
6. New session → /login → enter unregistered email → see "Check your email" message (no enumeration).
7. New invite via admin UI → click invite link → auto-logged in.

- [ ] **Step 2: Invoke verification-before-completion**

Per workflow Phase 6 — confirm with evidence (screenshots, log excerpts) that every scenario passes before claiming done.

---

## Workflow Phase 7 — Finish

- [ ] **Step 1: Open PR**

Use `gh pr create` against `main`. Title: `feat(auth): passwordless login (OTP + magic link) on Resend`.

- [ ] **Step 2: PR body should include**
- Link to spec (`docs/superpowers/specs/2026-05-20-passwordless-login-design.md`)
- Bulleted summary of changes per phase
- Manual test plan checklist (the 7 scenarios above)
- Note about the 30-day follow-up: "Schedule 2026-06-19: remove password fallback link, delete set-password and welcome stubs, run `signInWithPassword` removal."

---

## Deferred work (out of scope for this plan)

**Phase 3b — 30-day cleanup (separate PR, scheduled for 2026-06-19):**
- Delete the `mode === 'password'` branch from `login/page.tsx`.
- Delete the "Use password instead" link and the `SHOW_PASSWORD_FALLBACK_UNTIL` constant.
- Delete `src/app/auth/set-password/page.tsx` and `src/app/auth/welcome/page.tsx`.
- Optionally null out `auth.users.encrypted_password` for any user who has signed in via OTP since 2026-05-20 (read `auth.audit_log_entries` for OTP successes).

**Non-auth email migration (separate effort):**
- Move `src/lib/email.ts` Nodemailer calls (`sendStageUpdateEmail`, `sendLoanFundedEmail`, `sendApplicationSubmittedEmail`, condition-action emails) onto Resend. Same `sendAuthEmail` pattern — rename to `sendTransactionalEmail` or split into a separate helper.
- Drop `nodemailer` and `GMAIL_*` env vars once nothing uses them.

---

## Self-review notes

**Spec coverage check:**
- ✅ All decisions in spec table map to tasks (auth methods → 2.4; passwords → 2.4 fallback; transition window → 2.4 `SHOW_PASSWORD_FALLBACK_UNTIL`; invite flow → 3.2; login page structure → 2.4; OTP defaults → 2.3 + spec; transport → 1.1 + 2.3; templates → 1.3 + 2.2; OTP generation → 1.4 + 2.3).
- ✅ Architecture sections map: Resend client → 1.1; send helper → 1.2; templates → 1.3, 2.2; send-otp route → 2.3; password reset migration → 1.4.
- ✅ Phased rollout — Phase 1/2/3 mapped to plan phases of the same name.
- ✅ Security checkpoints — verified in send-otp implementation (Task 2.3) and listed in Phase 5.
- ✅ Verification scenarios — all 7 in Phase 6.

**Type consistency check:**
- `sendAuthEmail` signature: `{ to, subject, html }` in Task 1.2; called with same shape in Tasks 1.4 and 2.3. ✅
- `renderSignInCodeEmail` returns `{ subject, html }` in Task 2.2; destructured in Task 2.3. ✅
- `renderPasswordResetEmail` returns `{ subject, html }` in Task 1.3; destructured in Task 1.4. ✅

**No placeholders detected.** Every step contains the code or command needed.
