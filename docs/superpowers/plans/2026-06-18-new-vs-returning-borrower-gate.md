# New vs Returning Borrower Entry Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/apply` a single-URL gate that asks new vs returning, pre-fills returning borrowers' personal info into a fresh application, and auto-creates a portal account + access email for new borrowers at submit.

**Architecture:** `/apply/page.tsx` becomes a server-side decider with three render cases (authenticated borrower -> pre-filled wizard; embed/admin -> blank wizard; everyone else -> a client `ApplyGate` that does the chooser + inline OTP login). No `/apply/new` route exists, so a blank application is never directly reachable by a logged-in borrower. Account creation reuses the existing idempotent `ensureBorrowerActivationLink`; pre-fill reads the borrower's most recent submitted `loan_applications.data` and keeps only person-level fields.

**Tech Stack:** Next.js 16 App Router (Server + Client Components), Supabase (cookie auth via `@supabase/ssr`, service-role admin client), Resend via `src/lib/mailer.ts`, Tailwind v4.

## Global Constraints

- No automated test suite exists. `npm run build` (TypeScript + ESLint) is the correctness gate for every task. Final prod verification uses `npx next build --turbopack` (Vercel uses Turbopack, which is stricter).
- No em dashes anywhere (code, copy, comments). Plain hyphens only.
- Auth pattern: `createClient()` (cookie/anon) for session checks; `createAdminClient()` (service role) for all data reads/writes. Never read sensitive data with the anon client.
- Do not change the broker flow (`/broker/apply`, broker variant, broker endpoints).
- No schema/migration changes.
- Pre-fill must be derived ONLY from the authenticated session's own borrower row, never from a client-supplied email/id.
- Brand color in this flow: `#1F5D8F` (primary), `#0F3A5E` (hover), matching existing apply UI.

---

## File Structure

- Create `src/lib/application/prefill.ts` - server helper: load + strip prior application data to person-level only.
- Create `src/lib/application/new-account-email.ts` - server helper: create/link account and send the access-instructions email.
- Create `src/app/apply/_components/apply-gate.tsx` - client chooser + inline OTP login state machine.
- Modify `src/app/apply/_components/wizard.tsx` - add `authenticated` prop; skip duplicate-account check and create draft on mount when authenticated.
- Modify `src/app/apply/page.tsx` - the three-case server decider.
- Modify `src/lib/application/submit-core.ts` - create account + send access email for new borrowers, off the critical path.
- Modify `src/app/apply/submitted/page.tsx` - confirmation copy mentioning portal access email.
- Modify `docs/embed-on-wordpress.md` - document the `?embed=1` chooser-bypass behavior.

---

## Task 1: Pre-fill helper (person-level strip + load)

**Files:**
- Create: `src/lib/application/prefill.ts`

**Interfaces:**
- Produces: `loadBorrowerPrefill(email: string): Promise<ApplicationData>` - returns a person-level-only `ApplicationData` ({} when nothing found). `stripToPersonal(data: ApplicationData): ApplicationData` - exported for reuse/inspection.

- [ ] **Step 1: Write the helper**

Create `src/lib/application/prefill.ts`:

```ts
// Builds the pre-filled ApplicationData for a returning borrower starting a new
// application. Keeps ONLY person-level fields (identity, contact, address,
// experience, demographics). Property/deal, declarations, and authorization
// signatures are intentionally dropped so the borrower adds the new property,
// re-confirms declarations, and re-signs every application.
//
// Whitelist (keep) approach, not blacklist (strip): anything not explicitly
// person-level is dropped, so new deal fields can never leak across applications.

import { createAdminClient } from '@/lib/supabase/admin'
import type { ApplicationData } from '@/lib/application-fields'
import { EXPERIENCE_FIELDS, HMDA_FIELDS } from '@/lib/application-fields'

// Root-level (un-prefixed) keys that are person-level and safe to carry over.
const KEEP_ROOT_KEYS: string[] = [
  ...EXPERIENCE_FIELDS.map((f) => f.name),
  ...HMDA_FIELDS.map((f) => f.name),
]

/** Reduce a full application payload to person-level fields only. */
export function stripToPersonal(data: ApplicationData): ApplicationData {
  const out: ApplicationData = {}
  const rec = data as Record<string, unknown>
  if (rec.primary && typeof rec.primary === 'object') out.primary = rec.primary
  if (Array.isArray(rec.co_borrowers)) out.co_borrowers = rec.co_borrowers
  for (const k of KEEP_ROOT_KEYS) {
    if (rec[k] !== undefined && rec[k] !== null && rec[k] !== '') out[k] = rec[k]
  }
  return out
}

/** Map a borrowers table row to a minimal person-level prefill (legacy fallback
 *  for borrowers who never used the new wizard, e.g. Airtable/Pipedrive imports). */
function borrowerRowToPrefill(b: Record<string, unknown>): ApplicationData {
  const fullName = (b.full_name as string | null) ?? ''
  const parts = fullName.trim().split(/\s+/)
  const first = parts.length > 0 ? parts[0] : ''
  const last = parts.length > 1 ? parts[parts.length - 1] : ''
  const primary: Record<string, unknown> = {
    first_name: first,
    last_name: last,
    email: b.email ?? '',
    cell_phone: b.phone ?? '',
    entity_name: b.entity_name ?? '',
    address_street: b.current_address_street ?? '',
    address_city: b.current_address_city ?? '',
    address_state: b.current_address_state ?? '',
    address_zip: b.current_address_zip ?? '',
    prior_address_street: b.prior_address_street ?? '',
    prior_address_city: b.prior_address_city ?? '',
    prior_address_state: b.prior_address_state ?? '',
    prior_address_zip: b.prior_address_zip ?? '',
  }
  // Drop empties so the wizard's required-field gating still flags blanks.
  const cleaned = Object.fromEntries(
    Object.entries(primary).filter(([, v]) => v !== null && v !== undefined && v !== ''),
  )
  return { primary: cleaned }
}

/** Load a person-level prefill for a returning borrower by email. Prefers their
 *  most recent submitted application's saved data; falls back to the borrowers
 *  row for legacy borrowers. Returns {} if nothing is found. */
export async function loadBorrowerPrefill(email: string): Promise<ApplicationData> {
  const admin = createAdminClient()

  const { data: app } = await admin
    .from('loan_applications')
    .select('data, created_at')
    .ilike('resume_email', email)
    .eq('status', 'submitted')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (app?.data && typeof app.data === 'object') {
    return stripToPersonal(app.data as ApplicationData)
  }

  const { data: b } = await admin
    .from('borrowers')
    .select('full_name, email, phone, entity_name, current_address_street, current_address_city, current_address_state, current_address_zip, prior_address_street, prior_address_city, prior_address_state, prior_address_zip')
    .ilike('email', email)
    .maybeSingle()

  if (b) return borrowerRowToPrefill(b as Record<string, unknown>)
  return {}
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: PASS (no TypeScript or ESLint errors). The module is not imported anywhere yet, so this only checks it compiles.

- [ ] **Step 3: Commit**

```bash
git add src/lib/application/prefill.ts
git commit -m "feat(apply): add person-level prefill loader for returning borrowers"
```

---

## Task 2: New-applicant access email helper

**Files:**
- Create: `src/lib/application/new-account-email.ts`

**Interfaces:**
- Consumes: `ensureBorrowerActivationLink(email, fullName?)` from `@/lib/invite-borrower`, `sendEmail` from `@/lib/mailer`.
- Produces: `sendNewApplicantAccessEmail(email: string, fullName?: string): Promise<void>` - creates/links the auth account and emails access instructions. Throws on failure (caller wraps in try/catch).

- [ ] **Step 1: Write the helper**

Create `src/lib/application/new-account-email.ts`:

```ts
// Sent to a brand-new borrower right after they submit their first application.
// Creates (or links) their Supabase auth account via the shared idempotent
// helper, then emails a single-use sign-in link with application-context copy.
//
// Distinct from invite-borrower.ts (admin "you've been invited" copy): this is
// the post-submission "your application is in, here's how to get into your
// portal" message. Both reuse ensureBorrowerActivationLink for the account work.

import { ensureBorrowerActivationLink } from '@/lib/invite-borrower'
import { sendEmail } from '@/lib/mailer'

export async function sendNewApplicantAccessEmail(email: string, fullName?: string): Promise<void> {
  const link = await ensureBorrowerActivationLink(email, fullName)

  const firstName = (fullName ?? '').trim().split(/\s+/)[0]
  const greetingName = firstName || (fullName ?? '').trim() || 'there'

  await sendEmail({
    to: email,
    subject: 'Your First Equity Funding application was received',
    html: `
      <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">Hi ${greetingName},</p>
      <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
        Thank you for applying with <strong>First Equity Funding</strong>. We have received your
        application and created a secure portal account for you, where you can track your loan,
        upload documents, and message your team.
      </p>
      <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
        Click the button below to set up access to your portal.
      </p>
      <p style="margin-top: 24px;">
        <a href="${link}" style="background-color: #1F5D8F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-family: Arial, sans-serif; font-size: 14px; font-weight: bold;">
          Access Your Portal
        </a>
      </p>
      <p style="font-family: Arial, sans-serif; font-size: 12px; color: #999; margin-top: 24px;">
        This link expires in 24 hours and can only be used once. After it expires you can always
        sign in at the portal login with your email and a one-time code.
      </p>
      <p style="font-family: Arial, sans-serif; font-size: 12px; color: #999;">First Equity Funding Online Portal</p>
    `,
  })
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: PASS. Not yet imported anywhere; checks compilation only.

- [ ] **Step 3: Commit**

```bash
git add src/lib/application/new-account-email.ts
git commit -m "feat(apply): add new-applicant portal access email helper"
```

---

## Task 3: Wizard accepts an `authenticated` mode

**Files:**
- Modify: `src/app/apply/_components/wizard.tsx:46-53` (props), `:147-166` (`checkAccountIfNeeded`), and add a mount effect after `:183` (`ensureDraft`).

**Interfaces:**
- Produces: `Wizard` gains optional prop `authenticated?: boolean` (default `false`). When `true`: the duplicate-account check is skipped, and the draft is created on mount from the pre-filled primary email.

- [ ] **Step 1: Add the prop to the signature**

In `src/app/apply/_components/wizard.tsx`, change the component signature (line 46-53) from:

```tsx
export function Wizard({ initialData, initialStep, initialToken, isAdmin = false, loanOfficerOptions, variantKind = 'borrower' }: {
  initialData: ApplicationData
  initialStep: number
  initialToken: string | null
  isAdmin?: boolean
  loanOfficerOptions: string[]
  variantKind?: VariantKind
}) {
```

to:

```tsx
export function Wizard({ initialData, initialStep, initialToken, isAdmin = false, loanOfficerOptions, variantKind = 'borrower', authenticated = false }: {
  initialData: ApplicationData
  initialStep: number
  initialToken: string | null
  isAdmin?: boolean
  loanOfficerOptions: string[]
  variantKind?: VariantKind
  authenticated?: boolean
}) {
```

- [ ] **Step 2: Skip the duplicate-account check when authenticated**

In `checkAccountIfNeeded` (line 147), add an early return at the very top of the callback body, before the `duplicateAccountBehavior` check:

```tsx
  const checkAccountIfNeeded = useCallback(async (email: string): Promise<boolean> => {
    // Authenticated returning borrowers already own this account; the duplicate
    // gate must not fire for them.
    if (authenticated) return true
    if (variant.features.duplicateAccountBehavior !== 'block') return true
```

Then add `authenticated` to that callback's dependency array (change `}, [variant.features.duplicateAccountBehavior])` to `}, [variant.features.duplicateAccountBehavior, authenticated])`).

- [ ] **Step 3: Create the draft on mount when authenticated**

Immediately after the `ensureDraft` `useCallback` (ends at line 183 with its dependency array), add:

```tsx
  // A returning borrower lands with their email pre-filled and never blurs it,
  // so kick off the draft on mount. Autosave + submit both need a resume token.
  useEffect(() => {
    if (!authenticated || token) return
    const primary = data.primary as Record<string, unknown> | undefined
    const email = typeof primary?.email === 'string' ? primary.email : ''
    const firstName = typeof primary?.first_name === 'string' ? primary.first_name : ''
    if (email) void ensureDraft(email, firstName)
    // Run once on mount for the authenticated case; ensureDraft self-guards on token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated])
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: PASS. Existing `/apply` callers pass no `authenticated` prop, so it defaults to `false` and behavior is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/app/apply/_components/wizard.tsx
git commit -m "feat(apply): add authenticated mode to Wizard (skip dup check, draft on mount)"
```

---

## Task 4: ApplyGate (chooser + inline OTP login)

**Files:**
- Create: `src/app/apply/_components/apply-gate.tsx`

**Interfaces:**
- Consumes: `Wizard` with `authenticated` prop (Task 3); Supabase browser client `createClient` from `@/lib/supabase/client`.
- Produces: `ApplyGate({ loanOfficerOptions }: { loanOfficerOptions: string[] })` - default-exported is not required; export named `ApplyGate`.

- [ ] **Step 1: Write the component**

Create `src/app/apply/_components/apply-gate.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { Wizard } from './wizard'

type View = 'choose' | 'new' | 'login'
type LoginMode = 'email' | 'code'

export function ApplyGate({ loanOfficerOptions }: { loanOfficerOptions: string[] }) {
  const router = useRouter()
  const supabase = createClient()

  const [view, setView] = useState<View>('choose')
  const [loginMode, setLoginMode] = useState<LoginMode>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // New borrower: render the standard blank wizard inline (no navigation).
  if (view === 'new') {
    return (
      <Wizard
        initialData={{}}
        initialStep={1}
        initialToken={null}
        isAdmin={false}
        loanOfficerOptions={loanOfficerOptions}
        variantKind="borrower"
        authenticated={false}
      />
    )
  }

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    // shouldCreateUser:false: an unknown email never creates an account here.
    // We always advance to the code screen to avoid email enumeration.
    try {
      await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/apply`,
        },
      })
    } finally {
      setLoading(false)
    }
    setLoginMode('code')
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
    // Session cookie is now set. Re-render the server page; it will see an
    // authenticated borrower and return the pre-filled wizard at this same URL.
    router.refresh()
  }

  return (
    <div className="mx-auto max-w-md px-6 py-10">
      <div className="mb-8 text-center">
        <Image src="/logo-main.png" alt="First Equity Funding" width={724} height={86} className="mx-auto mb-3 h-16 w-auto" />
      </div>

      {view === 'choose' && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900">Apply for a loan</h1>
          <p className="mt-1 text-sm text-gray-500">Let us know if you have worked with us before.</p>
          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setView('new')}
              className="inline-flex h-12 items-center justify-center rounded-md bg-[#1F5D8F] px-5 text-base font-semibold text-white transition-colors hover:bg-[#0F3A5E]"
            >
              I am a new borrower
            </button>
            <button
              type="button"
              onClick={() => { setView('login'); setLoginMode('email'); setError('') }}
              className="inline-flex h-12 items-center justify-center rounded-md border border-gray-300 px-5 text-base font-medium text-gray-700 transition-colors hover:border-[#1F5D8F] hover:text-[#1F5D8F]"
            >
              I am a returning customer
            </button>
          </div>
          <p className="mt-4 text-center text-xs text-gray-400">
            Returning customers sign in so we can pre-fill your saved information.
          </p>
        </div>
      )}

      {view === 'login' && loginMode === 'email' && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900">Welcome back</h1>
          <p className="mt-1 text-sm text-gray-500">Enter your email and we will send you a sign-in code.</p>
          <form onSubmit={handleSendCode} className="mt-5 space-y-4">
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 w-full rounded-md border border-gray-300 px-3 text-sm outline-none focus:border-[#1F5D8F]"
            />
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-11 w-full items-center justify-center rounded-md bg-[#1F5D8F] px-5 text-base font-semibold text-white transition-colors hover:bg-[#0F3A5E] disabled:opacity-60"
            >
              {loading ? 'Sending…' : 'Send sign-in code'}
            </button>
          </form>
          <button
            type="button"
            onClick={() => { setView('choose'); setError('') }}
            className="mt-4 w-full text-center text-sm text-gray-500 hover:text-gray-800"
          >
            ← I am actually a new borrower
          </button>
        </div>
      )}

      {view === 'login' && loginMode === 'code' && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900">Check your email</h1>
          <p className="mt-1 text-sm text-gray-500">We sent a 6-digit code to <strong>{email}</strong>. Enter it below.</p>
          <form onSubmit={handleVerifyCode} className="mt-5 space-y-4">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              autoFocus
              className="h-11 w-full rounded-md border border-gray-300 px-3 text-sm tracking-widest outline-none focus:border-[#1F5D8F]"
            />
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="inline-flex h-11 w-full items-center justify-center rounded-md bg-[#1F5D8F] px-5 text-base font-semibold text-white transition-colors hover:bg-[#0F3A5E] disabled:opacity-60"
            >
              {loading ? 'Verifying…' : 'Verify and continue'}
            </button>
          </form>
          <button
            type="button"
            onClick={() => { setLoginMode('email'); setCode(''); setError('') }}
            className="mt-4 w-full text-center text-sm text-gray-500 hover:text-gray-800"
          >
            Use a different email
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: PASS. Not yet rendered anywhere; checks compilation.

- [ ] **Step 3: Commit**

```bash
git add src/app/apply/_components/apply-gate.tsx
git commit -m "feat(apply): add ApplyGate chooser with inline OTP login"
```

---

## Task 5: Rewire `/apply/page.tsx` as the three-case decider

**Files:**
- Modify: `src/app/apply/page.tsx`

**Interfaces:**
- Consumes: `loadBorrowerPrefill` (Task 1), `ApplyGate` (Task 4), `Wizard` `authenticated` prop (Task 3).

- [ ] **Step 1: Replace the page**

Replace the entire contents of `src/app/apply/page.tsx` with:

```tsx
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Wizard } from './_components/wizard'
import { ApplyGate } from './_components/apply-gate'
import { loadBorrowerPrefill } from '@/lib/application/prefill'
import { isValidEmbedTestKey } from '@/lib/application/embed-test'
import type { ApplicationData } from '@/lib/application-fields'

export const metadata = { title: 'Loan Application - First Equity Funding' }

async function checkIsAdmin(userId: string): Promise<boolean> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('admin_users')
      .select('id')
      .eq('auth_user_id', userId)
      .maybeSingle()
    return !!data
  } catch {
    return false
  }
}

async function fetchBorrowerByAuthId(userId: string): Promise<{ id: string; email: string } | null> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('borrowers')
      .select('id, email')
      .eq('auth_user_id', userId)
      .maybeSingle()
    return data && data.email ? { id: data.id as string, email: data.email as string } : null
  } catch {
    return null
  }
}

async function fetchLoanOfficerOptions(): Promise<string[]> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('loan_officers')
      .select('full_name')
      .order('full_name')
    const names = (data ?? [])
      .map((lo) => (lo.full_name as string | null) ?? '')
      .filter((n) => n.trim().length > 0)
    return [...names, 'Other']
  } catch {
    return ['Other']
  }
}

export default async function ApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams
  const testKey = typeof sp.testkey === 'string' ? sp.testkey : null
  // Embed mode: the WordPress iframe is cross-site/unauthenticated and expects
  // the form directly, so it bypasses the chooser. A valid testkey also bypasses
  // (admin embed test mode without a cookie).
  const isEmbed = sp.embed === '1' || isValidEmbedTestKey(testKey)

  const loanOfficerOptions = await fetchLoanOfficerOptions()

  // Who is asking?
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Case 1: authenticated borrower (not in embed) -> pre-filled wizard. This is
  // the ONLY way a logged-in borrower can reach the form, so they can never get
  // a blank application.
  if (user && !isEmbed) {
    const borrower = await fetchBorrowerByAuthId(user.id)
    if (borrower) {
      const initialData: ApplicationData = await loadBorrowerPrefill(borrower.email)
      return (
        <Suspense>
          <Wizard
            initialData={initialData}
            initialStep={1}
            initialToken={null}
            isAdmin={false}
            loanOfficerOptions={loanOfficerOptions}
            variantKind="borrower"
            authenticated
          />
        </Suspense>
      )
    }
    // Case 2a: authenticated admin -> blank form with test mode (preserves
    // current admin access to /apply for testing). Other staff fall through to
    // the chooser.
    const isAdmin = await checkIsAdmin(user.id)
    if (isAdmin) {
      return (
        <Suspense>
          <Wizard
            initialData={{}}
            initialStep={1}
            initialToken={null}
            isAdmin
            loanOfficerOptions={loanOfficerOptions}
            variantKind="borrower"
          />
        </Suspense>
      )
    }
  }

  // Case 2b: embed (or valid testkey) -> blank form directly, as before.
  if (isEmbed) {
    return (
      <Suspense>
        <Wizard
          initialData={{}}
          initialStep={1}
          initialToken={null}
          isAdmin={isValidEmbedTestKey(testKey)}
          loanOfficerOptions={loanOfficerOptions}
          variantKind="borrower"
        />
      </Suspense>
    )
  }

  // Case 3: everyone else (unauthenticated, or authenticated non-borrower
  // non-admin) -> the chooser + inline login at this same URL.
  return (
    <Suspense>
      <ApplyGate loanOfficerOptions={loanOfficerOptions} />
    </Suspense>
  )
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Manual smoke (dev server)**

Run: `npm run dev` (worktree dev runs on port 3100 per project convention).
Check, in an incognito window:
- `http://localhost:3100/apply` shows the chooser (two buttons), not the form.
- `http://localhost:3100/apply?embed=1` shows the form directly.
- Clicking "I am a new borrower" reveals the blank wizard inline (URL stays `/apply`).
- Clicking "I am a returning customer" reveals the inline email form.
Expected: all four behaviors as described. (Full returning login round-trip is verified in Phase 6 with a real account.)

- [ ] **Step 4: Commit**

```bash
git add src/app/apply/page.tsx
git commit -m "feat(apply): make /apply a new-vs-returning decider on a single URL"
```

---

## Task 6: Auto-create account + access email at submit (new borrowers)

**Files:**
- Modify: `src/lib/application/submit-core.ts` (add an `after()` block after the existing notifications block at `:152-163`, before `return` at `:165`).

**Interfaces:**
- Consumes: `sendNewApplicantAccessEmail` (Task 2).

- [ ] **Step 1: Import the helper**

At the top of `src/lib/application/submit-core.ts`, add to the imports (after the `./notify` import on line 9):

```ts
import { sendNewApplicantAccessEmail } from './new-account-email'
```

- [ ] **Step 2: Add the account-creation block**

Immediately after the existing notifications `after(...)` block (closes at line 163) and before `return { ok: true, loanId, authorizeToken }` (line 165), insert:

```ts
  // 7. New-borrower portal account + access email (borrower variant only),
  //    off the response critical path. The borrowers row was upserted in step 1
  //    without an auth_user_id; if it is still unlinked, this is a brand-new
  //    borrower and we create their account + email them access instructions.
  //    A returning borrower already has auth_user_id, so this is a no-op and no
  //    duplicate access email is sent. A mail/auth failure never fails submit.
  if (variant === 'borrower') {
    const primaryEmail = m.borrowers[0]?.email?.toLowerCase() ?? null
    const primaryName = m.borrowers[0]?.full_name ?? undefined
    if (primaryEmail) {
      after(async () => {
        try {
          const { data: brow } = await admin
            .from('borrowers')
            .select('auth_user_id')
            .eq('email', primaryEmail)
            .maybeSingle()
          if (brow && !brow.auth_user_id) {
            await sendNewApplicantAccessEmail(primaryEmail, primaryName)
          }
        } catch (err) {
          console.error('New applicant access email failed:', err)
        }
      })
    }
  }
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/application/submit-core.ts
git commit -m "feat(apply): auto-create portal account + access email on new-borrower submit"
```

---

## Task 7: Confirmation copy + embed doc note

**Files:**
- Modify: `src/app/apply/submitted/page.tsx`
- Modify: `docs/embed-on-wordpress.md`

**Interfaces:** none.

- [ ] **Step 1: Read the submitted page**

Read `src/app/apply/submitted/page.tsx` to find the confirmation message block (the success heading + body paragraph).

- [ ] **Step 2: Add portal-access line**

Add a sentence to the confirmation body that works for both new and returning borrowers (the page does not know which). Insert, after the existing "we received your application" style copy, a paragraph such as:

```tsx
<p className="mt-3 text-sm text-gray-600">
  If this is your first application with us, check your email for a link to set up
  access to your portal, where you can track your loan and upload documents. If you
  already have a portal account, your new loan is connected to it automatically.
</p>
```

Match the surrounding element/className conventions in the actual file (adjust the wrapper to fit how that page styles its copy). Do not introduce em dashes.

- [ ] **Step 3: Document the embed bypass**

In `docs/embed-on-wordpress.md`, under the "What each piece does" table, add a row documenting that `?embed=1` also bypasses the new-vs-returning chooser:

```markdown
| `?embed=1` bypasses the chooser | On the portal, `/apply` now shows a "new vs returning borrower" chooser first. The `?embed=1` flag tells the app to skip that chooser and render the blank application form directly, so the embedded WordPress form behaves exactly as before. Returning-customer sign-in is a portal-native flow and is intentionally not offered inside the iframe. |
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/apply/submitted/page.tsx docs/embed-on-wordpress.md
git commit -m "feat(apply): confirmation copy for portal access + document embed chooser bypass"
```

---

## Verification (Phase 6 - performed after all tasks)

Not a code task; performed by the workflow's verification phase. Listed here so the implementer leaves the tree in a verifiable state.

- `npx next build --turbopack` passes (prod parity).
- `playwright-role-gates` skill: all five role sign-ins still land only on their own routes (this change adds borrower detection at `/apply`; confirm no role-gate regression).
- Browser walkthrough (Playwright MCP):
  - New path: `/apply` -> "new borrower" -> complete + submit a test application -> confirmation shows portal-access copy -> access email is generated (verify via logs / test override inbox) -> the emailed link signs into the portal.
  - Returning path: with a borrower that has a prior submitted application, `/apply` -> "returning" -> email + code -> same URL now shows the wizard pre-filled with personal info, property/deal blank, declarations + authorization unsigned.
  - Deep-link guard: while signed in as that borrower, visiting `/apply` always shows the pre-filled form, never a blank one.
  - Embed: `/apply?embed=1` still renders the form directly.
- security-review (Phase 5) passes, with attention to: prefill derived only from the session's own `auth_user_id`; OTP `shouldCreateUser:false`; no client-supplied identifier trusted for data selection.

---

## Self-Review

**Spec coverage:**
- Chooser at single URL -> Task 5 (case 3) + Task 4. ✓
- Returning identified by email + OTP -> Task 4 inline login. ✓
- Returning pre-filled full personal profile -> Task 1 + Task 5 (case 1). ✓
- Property/deal blank, declarations + authorization re-confirmed -> Task 1 whitelist (keeps only primary/co_borrowers/experience/HMDA). ✓
- New borrower account auto-created + access email at submit -> Task 6 + Task 2. ✓
- No deep-linkable blank app for authenticated borrower -> Task 5 (case 1 is the only authenticated render). ✓
- Embed back-compat -> Task 5 (case 2b) + Task 7 doc. ✓
- Legacy borrower partial pre-fill -> Task 1 `borrowerRowToPrefill` fallback. ✓
- No schema changes -> confirmed; all reads use existing tables. ✓

**Placeholder scan:** No TBD/TODO. Task 7 Step 2 intentionally instructs matching the file's existing markup (the file was not read at plan-time); the exact copy to add is given verbatim. All code steps include full code.

**Type consistency:** `loadBorrowerPrefill(email): Promise<ApplicationData>` defined in Task 1, consumed in Task 5. `sendNewApplicantAccessEmail(email, fullName?)` defined in Task 2, consumed in Task 6. `Wizard` `authenticated?: boolean` defined in Task 3, consumed in Tasks 4 and 5. `ApplyGate({ loanOfficerOptions })` defined in Task 4, consumed in Task 5. `m.borrowers[0].email` / `.full_name` used in Task 6 match the `MappedApplication` shape used elsewhere in `submit-core.ts`. Consistent.
