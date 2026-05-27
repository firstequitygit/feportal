# Apply Test Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an admin-only "Test mode" on `/apply` that exercises the full PDF + email pipeline against configurable test recipients without writing to live tables, storage, or `auth.users`.

**Architecture:** Server component on `/apply` performs an admin lookup and passes `isAdmin` into the client wizard. When the admin flips the toggle, the wizard renders a control panel (scenario picker, email overrides, helpers), suppresses autosave, and on submit POSTs to a parallel `/api/apply/test-submit` endpoint. That endpoint re-checks admin auth, validates required fields, generates the masked PDF via the existing `renderApplicationPdf`, and dispatches through a parallel `apply-notify-test.ts` orchestrator that attaches the PDF inline to the internal email and prefixes subjects with `[TEST]`. Non-admin and toggle-off paths are byte-identical to today.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4, Supabase (auth/admin), `@react-pdf/renderer`, Resend (via `src/lib/mailer.ts`).

**Working tree:** `C:\Users\apalm\FE-Portal\feportal-apply` on branch `feature/apply-test-mode`.

**Project conventions (read before starting):**
- No test runner. The correctness gate per task is `npx tsc --noEmit`. The final gate is `npm run build`.
- Use the PowerShell tool for stateful shell commands. Prefix each PowerShell call with `Set-Location C:\Users\apalm\FE-Portal\feportal-apply` because PS state does not persist between calls. Bash tool writes do not persist to the real filesystem.
- Use plain hyphens only. No em dashes (—) anywhere - code, copy, commit messages, prose.
- Brand color: `#1F5D8F` (navy). Background light: white / `bg-gray-50`. Geist font is the default.

---

## File structure

**New files:**
- `src/lib/test-data/generators.ts` - pure RNG helpers (names, addresses, currency, SSN, phone, date).
- `src/lib/test-data/scenarios.ts` - one `buildScenario(key)` builder per scenario, returns `ApplicationData`.
- `src/lib/apply-notify-test.ts` - parallel orchestrator: borrower + internal emails with `[TEST]` prefix and PDF attached inline to the internal one.
- `src/app/api/apply/test-pdf/route.ts` - admin-only POST that returns the PDF inline.
- `src/app/api/apply/test-submit/route.ts` - admin-only POST that runs the full notification path with overridden recipients and writes nothing.
- `src/app/apply/_components/test-mode-panel.tsx` - the visible panel (toggle-on UI: scenario picker, overrides, buttons).
- `src/app/apply/test-submitted/page.tsx` - test confirmation page.

**Edited files:**
- `src/app/apply/page.tsx` - convert to async server component, do the admin lookup, pass `isAdmin` to `<Wizard>`.
- `src/app/apply/_components/wizard.tsx` - accept `isAdmin`, add test-mode state + toggle + banner + panel mount + submit-route switch + autosave-disable plumbing + ensureDraft no-op in test mode.
- `src/app/apply/_components/use-autosave.ts` - accept a `disabled?: boolean` flag and no-op when set.

Each file has one job. The orchestrator is a parallel of `apply-notify.ts` rather than a branch inside it to keep the prod path untouched.

---

## Task 1: Server-side admin gate on `/apply`

**Files:**
- Modify: `src/app/apply/page.tsx`
- Modify: `src/app/apply/_components/wizard.tsx` (props only - add `isAdmin`, no behavior change yet)

- [ ] **Step 1: Convert page.tsx to async server component with admin lookup**

Replace the entire file:

```tsx
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Wizard } from './_components/wizard'

export const metadata = { title: 'Loan Application - First Equity Funding' }

async function checkIsAdmin(): Promise<boolean> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false
    const admin = createAdminClient()
    const { data } = await admin
      .from('admin_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle()
    return !!data
  } catch {
    return false
  }
}

export default async function ApplyPage() {
  const isAdmin = await checkIsAdmin()
  return (
    <Suspense>
      <Wizard initialData={{}} initialStep={1} initialToken={null} isAdmin={isAdmin} />
    </Suspense>
  )
}
```

The try/catch wraps the entire lookup so anonymous visitors (no session cookie) fall through to `isAdmin = false` and see today's unchanged page. Never redirect; never throw.

- [ ] **Step 2: Accept `isAdmin` prop in Wizard (no behavior change)**

In `src/app/apply/_components/wizard.tsx`, change the component signature:

```tsx
export function Wizard({ initialData, initialStep, initialToken, isAdmin = false }: {
  initialData: ApplicationData; initialStep: number; initialToken: string | null; isAdmin?: boolean
}) {
```

Do not use `isAdmin` anywhere yet. Subsequent tasks consume it.

- [ ] **Step 3: Type-check**

Run:

```powershell
Set-Location C:\Users\apalm\FE-Portal\feportal-apply; npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```powershell
Set-Location C:\Users\apalm\FE-Portal\feportal-apply; git add src/app/apply/page.tsx src/app/apply/_components/wizard.tsx; git commit -m "feat(apply): admin gate on /apply server component"
```

---

## Task 2: Test data generators

**Files:**
- Create: `src/lib/test-data/generators.ts`

- [ ] **Step 1: Write the generators module**

```ts
// Pure RNG helpers for /apply test mode. No external deps.

const FIRST_NAMES = [
  'Alex','Jordan','Taylor','Morgan','Casey','Riley','Avery','Quinn','Reese','Drew',
  'Sam','Charlie','Robin','Pat','Skyler','Jamie','Rowan','Hayden','Logan','Cameron',
] as const
const LAST_NAMES = [
  'Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez',
  'Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore',
] as const

interface AddressSample {
  street: string
  city: string
  state: string
  zip: string
}

// Hand-curated real city/state/zip triples to keep PDFs and address autocomplete-free renders sensible.
const ADDRESS_SAMPLES: AddressSample[] = [
  { street: '123 Maple Ave',   city: 'Sea Girt',     state: 'NJ', zip: '08750' },
  { street: '45 Ocean Blvd',   city: 'Asbury Park',  state: 'NJ', zip: '07712' },
  { street: '812 Pine St',     city: 'Toms River',   state: 'NJ', zip: '08753' },
  { street: '210 Elm Rd',      city: 'Red Bank',     state: 'NJ', zip: '07701' },
  { street: '57 Hudson St',    city: 'Hoboken',      state: 'NJ', zip: '07030' },
  { street: '99 Park Ave',     city: 'New York',     state: 'NY', zip: '10016' },
  { street: '404 Atlantic Ave',city: 'Brooklyn',     state: 'NY', zip: '11217' },
  { street: '300 Spruce Ln',   city: 'Stamford',     state: 'CT', zip: '06902' },
  { street: '88 Beach Rd',     city: 'Miami',        state: 'FL', zip: '33139' },
  { street: '15 Sunset Dr',    city: 'Tampa',        state: 'FL', zip: '33606' },
]

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function randomName(): { first: string; middle: string; last: string } {
  return {
    first: pick(FIRST_NAMES),
    middle: pick(FIRST_NAMES).slice(0, 1),
    last: pick(LAST_NAMES),
  }
}

export function randomAddress(): AddressSample {
  // Randomize the house number so re-runs aren't identical.
  const base = pick(ADDRESS_SAMPLES)
  const num = 100 + Math.floor(Math.random() * 9000)
  const streetTail = base.street.replace(/^\d+\s+/, '')
  return { ...base, street: `${num} ${streetTail}` }
}

export function randomCurrency(min: number, max: number, step = 1000): number {
  const range = Math.max(0, max - min)
  const v = min + Math.floor(Math.random() * (range / step + 1)) * step
  return v
}

export function randomDate(daysBack: number): string {
  // Returns YYYY-MM-DD anywhere in the past `daysBack` days (inclusive).
  const t = Date.now() - Math.floor(Math.random() * daysBack) * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

export function randomDOB(minAge = 28, maxAge = 65): string {
  // Returns YYYY-MM-DD for an adult between minAge and maxAge.
  const years = minAge + Math.floor(Math.random() * (maxAge - minAge + 1))
  const ms = Date.now() - years * 365.25 * 86_400_000 - Math.floor(Math.random() * 365) * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

export function randomSSN(): string {
  // 9 digits, formatted XXX-XX-XXXX. Avoid 000 area, 00 group, 0000 serial per real-world SSN rules.
  const area = 100 + Math.floor(Math.random() * 800)
  const group = 10 + Math.floor(Math.random() * 90)
  const serial = 1000 + Math.floor(Math.random() * 9000)
  return `${area}-${group}-${serial}`
}

export function randomPhone(): string {
  // (NXX) NXX-XXXX where N is 2-9.
  const a = 2 + Math.floor(Math.random() * 8)
  const b = 100 + Math.floor(Math.random() * 900)
  const c = 2 + Math.floor(Math.random() * 8)
  const d = 100 + Math.floor(Math.random() * 900)
  const e = 1000 + Math.floor(Math.random() * 9000)
  return `(${a}${Math.floor(Math.random() * 100).toString().padStart(2, '0')}) ${c}${b.toString().slice(0, 2)}-${e.toString().slice(0, 4)}${d.toString().slice(0, 0)}`.replace(/\s+/g, ' ').trim()
}

export function randomEmail(first: string, last: string): string {
  const suffix = Math.floor(Math.random() * 1000)
  return `${first}.${last}${suffix}@example.com`.toLowerCase()
}
```

- [ ] **Step 2: Type-check**

```powershell
Set-Location C:\Users\apalm\FE-Portal\feportal-apply; npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```powershell
Set-Location C:\Users\apalm\FE-Portal\feportal-apply; git add src/lib/test-data/generators.ts; git commit -m "feat(apply): test-data generators (pure RNG helpers)"
```

---

## Task 3: Scenario builders

Five scenarios, each returns a complete `ApplicationData` that passes `missingRequired`. Per the spec, scenarios cover the conditional branches of `DEAL_FIELDS` so each branch is exercised at least once.

**Files:**
- Create: `src/lib/test-data/scenarios.ts`

- [ ] **Step 1: Write the scenarios module**

```ts
import type { ApplicationData } from '@/lib/application-fields'
import {
  randomName, randomAddress, randomCurrency, randomDate, randomDOB,
  randomEmail, randomPhone, randomSSN,
} from './generators'

export type ScenarioKey =
  | 'fix-flip-purchase'
  | 'fix-flip-refi'
  | 'dscr-single-family'
  | 'dscr-multifamily-4unit'
  | 'bridge-new-construction'

export const SCENARIO_OPTIONS: Array<{ key: ScenarioKey; label: string }> = [
  { key: 'fix-flip-purchase',      label: 'Fix & Flip Purchase' },
  { key: 'fix-flip-refi',          label: 'Fix & Flip Refi' },
  { key: 'dscr-single-family',     label: 'DSCR Single Family' },
  { key: 'dscr-multifamily-4unit', label: 'DSCR Multifamily (4 units)' },
  { key: 'bridge-new-construction',label: 'Bridge New Construction' },
]

function primaryShell() {
  const n = randomName()
  const addr = randomAddress()
  return {
    first_name: n.first,
    middle_name: n.middle,
    last_name: n.last,
    dob: randomDOB(),
    ssn: randomSSN(),
    us_citizen: true,
    marital_status: 'Single' as const,
    email: randomEmail(n.first, n.last),
    cell_phone: randomPhone(),
    credit_score: '720-739' as const,
    address_street: addr.street,
    address_city: addr.city,
    address_state: addr.state,
    address_zip: addr.zip,
    lived_2y: true,
  }
}

function rootCommon() {
  return {
    flips_last_3y: '3 - 10',
    rental_units_owned: 2,
    d_liens: false,
    d_bankruptcy: false,
    d_delinquent: false,
    d_foreclosure_obligation: false,
    d_lawsuit: false,
    d_down_payment_borrowed: false,
    d_us_citizen: true,
    d_permanent_resident: false,
    d_intent_to_occupy: false,
    hmda_ethnicity: 'I do not wish to provide this information',
    hmda_race: 'I do not wish to provide this information',
    hmda_sex: 'I do not wish to provide this information',
    auth_signature: 'Test Applicant',
    payment_signature: 'Test Applicant',
    loan_officer_assigned: 'Anthony Palmiotto',
    hear_about_us: 'Internet Search (Google, Bing, etc.)',
    housing_status: 'Own',
    mortgage_on_primary: true,
  }
}

function propertyAddress() {
  const a = randomAddress()
  return {
    property_street: a.street,
    property_city: a.city,
    property_state: a.state,
    property_zip: a.zip,
  }
}

function fixFlipPurchase(): ApplicationData {
  return {
    primary: primaryShell(),
    ...rootCommon(),
    has_deal: true,
    purchase_or_refi: 'Purchase',
    loan_type: 'Fix & Flip/Renovation',
    property_type: 'Single Family',
    ...propertyAddress(),
    purchase_price: randomCurrency(150_000, 400_000),
    cash_for_down_payment: randomCurrency(30_000, 100_000, 5_000),
    construction_costs: randomCurrency(40_000, 120_000, 5_000),
    after_repaired_value: randomCurrency(300_000, 600_000),
    exit_strategy: 'Sale',
    requested_loan_amount: randomCurrency(200_000, 450_000, 5_000),
    reserves_post_closing: randomCurrency(20_000, 80_000, 5_000),
  }
}

function fixFlipRefi(): ApplicationData {
  return {
    primary: primaryShell(),
    ...rootCommon(),
    has_deal: true,
    purchase_or_refi: 'Refinance',
    loan_type: 'Fix & Flip/Renovation',
    property_type: 'Single Family',
    ...propertyAddress(),
    date_purchased: randomDate(720),
    original_purchase_price: randomCurrency(150_000, 350_000),
    renovations_completed: randomCurrency(20_000, 80_000, 5_000),
    current_value: randomCurrency(350_000, 600_000),
    current_debt: true,
    current_loan_balance: randomCurrency(150_000, 300_000, 5_000),
    lates_30_24mo: 0,
    construction_costs: randomCurrency(20_000, 60_000, 5_000),
    after_repaired_value: randomCurrency(450_000, 700_000),
    exit_strategy: 'Refinance',
    requested_loan_amount: randomCurrency(200_000, 400_000, 5_000),
    reserves_post_closing: randomCurrency(20_000, 80_000, 5_000),
  }
}

function dscrSingleFamily(): ApplicationData {
  return {
    primary: primaryShell(),
    ...rootCommon(),
    has_deal: true,
    purchase_or_refi: 'Purchase',
    loan_type: 'DSCR Rental Loan',
    property_type: 'Single Family',
    ...propertyAddress(),
    purchase_price: randomCurrency(200_000, 450_000),
    cash_for_down_payment: randomCurrency(50_000, 120_000, 5_000),
    annual_property_taxes: randomCurrency(4_000, 12_000, 100),
    annual_property_insurance: randomCurrency(1_200, 3_000, 100),
    monthly_flood_insurance: 0,
    monthly_hoa_dues: 0,
    requested_loan_amount: randomCurrency(180_000, 360_000, 5_000),
    reserves_post_closing: randomCurrency(20_000, 80_000, 5_000),
    units: [
      { currently_rented: true, current_rent: randomCurrency(1_800, 3_500, 50) },
    ],
  }
}

function dscrMultifamily4(): ApplicationData {
  const rent = () => randomCurrency(1_500, 2_400, 50)
  return {
    primary: primaryShell(),
    ...rootCommon(),
    has_deal: true,
    purchase_or_refi: 'Purchase',
    loan_type: 'DSCR Rental Loan',
    property_type: 'Multifamily (2-4 Units)',
    ...propertyAddress(),
    dscr_unit_count: '4',
    purchase_price: randomCurrency(500_000, 900_000),
    cash_for_down_payment: randomCurrency(120_000, 250_000, 5_000),
    annual_property_taxes: randomCurrency(10_000, 22_000, 100),
    annual_property_insurance: randomCurrency(3_000, 6_000, 100),
    monthly_flood_insurance: 0,
    monthly_hoa_dues: 0,
    requested_loan_amount: randomCurrency(400_000, 750_000, 5_000),
    reserves_post_closing: randomCurrency(40_000, 120_000, 5_000),
    units: [
      { currently_rented: true,  current_rent: rent() },
      { currently_rented: true,  current_rent: rent() },
      { currently_rented: false, market_rent:  rent() },
      { currently_rented: true,  current_rent: rent() },
    ],
  }
}

function bridgeNewConstruction(): ApplicationData {
  return {
    primary: primaryShell(),
    ...rootCommon(),
    has_deal: true,
    purchase_or_refi: 'Purchase',
    loan_type: 'New Construction',
    property_type: 'Single Family',
    ...propertyAddress(),
    purchase_price: randomCurrency(120_000, 280_000),
    cash_for_down_payment: randomCurrency(40_000, 100_000, 5_000),
    construction_costs: randomCurrency(180_000, 350_000, 5_000),
    after_repaired_value: randomCurrency(500_000, 850_000),
    exit_strategy: 'Sale',
    requested_loan_amount: randomCurrency(300_000, 600_000, 5_000),
    reserves_post_closing: randomCurrency(40_000, 120_000, 5_000),
  }
}

const BUILDERS: Record<ScenarioKey, () => ApplicationData> = {
  'fix-flip-purchase':      fixFlipPurchase,
  'fix-flip-refi':          fixFlipRefi,
  'dscr-single-family':     dscrSingleFamily,
  'dscr-multifamily-4unit': dscrMultifamily4,
  'bridge-new-construction':bridgeNewConstruction,
}

export function buildScenario(key: ScenarioKey): ApplicationData {
  return BUILDERS[key]()
}
```

- [ ] **Step 2: Type-check**

```powershell
Set-Location C:\Users\apalm\FE-Portal\feportal-apply; npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Verify scenarios pass `missingRequired` (ad-hoc node script)**

Create a throwaway script at the repo root and run it. This is a one-time check; do not commit the script.

Create `scripts/verify-scenarios.ts`:

```ts
import { buildScenario, SCENARIO_OPTIONS } from '@/lib/test-data/scenarios'
import {
  BORROWER_FIELDS, PRIMARY_EXTRA_FIELDS, DEAL_FIELDS, UNIT_FIELDS,
  DECLARATION_FIELDS, HMDA_FIELDS, dscrUnitCount, isRequired,
  type ApplicationData,
} from '@/lib/application-fields'

function isEmpty(v: unknown) {
  if (v === undefined || v === null || v === '') return true
  if (Array.isArray(v) && v.length === 0) return true
  return false
}

function missingRequired(data: ApplicationData): string[] {
  const miss: string[] = []
  const primary = (data.primary as Record<string, unknown>) ?? {}
  for (const f of [...BORROWER_FIELDS, ...PRIMARY_EXTRA_FIELDS]) {
    if (isRequired(f, data, primary) && isEmpty(primary[f.name])) miss.push(`primary.${f.name}`)
  }
  for (const f of DEAL_FIELDS) {
    if (isRequired(f, data) && isEmpty(data[f.name])) miss.push(f.name)
  }
  const uc = dscrUnitCount(data)
  if (uc > 0) {
    const units = Array.isArray(data.units) ? (data.units as Record<string, unknown>[]) : []
    for (let i = 0; i < uc; i++) {
      const scope = (units[i] ?? {}) as ApplicationData
      for (const f of UNIT_FIELDS) {
        if (isRequired(f, data, scope) && isEmpty(scope[f.name as keyof typeof scope])) miss.push(`unit${i + 1}.${f.name}`)
      }
    }
  }
  for (const f of [...DECLARATION_FIELDS, ...HMDA_FIELDS]) {
    if (isRequired(f, data) && isEmpty(data[f.name])) miss.push(f.name)
  }
  if (isEmpty(data.auth_signature)) miss.push('auth_signature')
  return miss
}

for (const opt of SCENARIO_OPTIONS) {
  const miss = missingRequired(buildScenario(opt.key))
  if (miss.length) { console.error(`FAIL ${opt.key}:`, miss); process.exit(1) }
  console.log(`OK   ${opt.key}`)
}
```

Run:

```powershell
Set-Location C:\Users\apalm\FE-Portal\feportal-apply; npx tsx scripts/verify-scenarios.ts
```

Expected output:
```
OK   fix-flip-purchase
OK   fix-flip-refi
OK   dscr-single-family
OK   dscr-multifamily-4unit
OK   bridge-new-construction
```

If any scenario fails, edit `scenarios.ts` to fill the missing keys and re-run until all five pass.

- [ ] **Step 4: Delete the throwaway script and commit**

```powershell
Set-Location C:\Users\apalm\FE-Portal\feportal-apply; Remove-Item scripts/verify-scenarios.ts; git add src/lib/test-data/scenarios.ts; git commit -m "feat(apply): test-mode scenario builders"
```

---

## Task 4: Test-mode email orchestrator

**Files:**
- Create: `src/lib/apply-notify-test.ts`

- [ ] **Step 1: Write the orchestrator**

```ts
import type { ApplicationData } from '@/lib/application-fields'
import { sendEmail } from '@/lib/mailer'
import { PORTAL_DOMAIN } from '@/lib/portal-url'

export interface TestOverrides {
  borrowerEmail: string
  processingInbox: string
  loEmail: string
}

export interface TestNotifyArgs {
  data: ApplicationData
  pdf: Buffer
  overrides: TestOverrides
  scenarioLabel: string | null
}

export interface TestNotifyResult {
  borrower: string | null
  internal: string[]
  pdfBytes: number
}

function validEmail(s: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)
}

function fmtAmount(amount: number | null | undefined): string | null {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return null
  return `$${Number(amount).toLocaleString('en-US')}`
}

function wrap(title: string, bodyHtml: string) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #333;">
      <div style="background-color: #b45309; padding: 12px 28px; border-radius: 8px 8px 0 0;">
        <p style="margin: 0; color: #fffbeb; font-size: 12px; font-weight: bold; letter-spacing: 0.5px;">TEST MODE - NOT A REAL APPLICATION</p>
      </div>
      <div style="background-color: #1F5D8F; padding: 20px 28px;">
        <h1 style="margin: 0; color: white; font-size: 18px;">${title}</h1>
      </div>
      <div style="background-color: #ffffff; padding: 28px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        ${bodyHtml}
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin-top: 20px;" />
        <p style="font-size: 11px; color: #9ca3af; margin-bottom: 0;">First Equity Funding Online Portal &nbsp;·&nbsp; ${PORTAL_DOMAIN}</p>
      </div>
    </div>`
}

export async function sendApplicationTestNotifications(args: TestNotifyArgs): Promise<TestNotifyResult> {
  const { data, pdf, overrides, scenarioLabel } = args

  const primary = (data.primary as Record<string, unknown>) ?? {}
  const primaryFirstName = (primary.first_name as string | undefined) ?? null
  const primaryFullName = [primary.first_name, primary.last_name].filter(Boolean).join(' ') || 'Test Applicant'
  const propertyAddress = [data.property_street, data.property_city, data.property_state, data.property_zip]
    .filter(Boolean).join(', ') || 'test property'
  const loanType = typeof data.loan_type === 'string' ? data.loan_type : null
  const loanAmount = typeof data.requested_loan_amount === 'number' ? data.requested_loan_amount : null
  const loanOfficerName = typeof data.loan_officer_assigned === 'string' ? data.loan_officer_assigned : null
  const amountLabel = fmtAmount(loanAmount)

  const result: TestNotifyResult = { borrower: null, internal: [], pdfBytes: pdf.length }

  // 1. Borrower-style email.
  if (validEmail(overrides.borrowerEmail)) {
    const recapRows = [
      `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">Property</td><td style="padding:4px 0;font-size:13px;"><strong>${propertyAddress}</strong></td></tr>`,
      loanType ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">Loan type</td><td style="padding:4px 0;font-size:13px;">${loanType}</td></tr>` : '',
      amountLabel ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">Requested amount</td><td style="padding:4px 0;font-size:13px;">${amountLabel}</td></tr>` : '',
    ].join('')
    const html = wrap('Application received', `
      <p style="font-size: 15px; margin-top: 0;">Hi ${primaryFirstName ?? 'there'},</p>
      <p style="font-size: 15px;">We've received your loan application. Our team will review it and reach out with next steps.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">${recapRows}</table>
      <p style="font-size: 13px; color: #92400e; background:#fef3c7; padding:10px 14px; border-radius:6px;">Test mode - activation link not generated.</p>`)
    try {
      await sendEmail({
        to: overrides.borrowerEmail,
        subject: '[TEST] We received your First Equity loan application',
        html,
      })
      result.borrower = overrides.borrowerEmail
    } catch (err) {
      console.error('Test borrower email failed:', err)
    }
  }

  // 2. Internal email with PDF attached inline.
  const internalRecipients = Array.from(new Set(
    [overrides.processingInbox, overrides.loEmail].filter(validEmail),
  ))
  if (internalRecipients.length > 0) {
    const scenarioLine = scenarioLabel
      ? `<p style="font-size: 13px; color: #92400e; background:#fef3c7; padding:8px 12px; border-radius:6px;">Scenario: <strong>${scenarioLabel}</strong></p>`
      : ''
    const html = wrap('New loan application', `
      ${scenarioLine}
      <p style="font-size: 15px; margin-top: 0;">A test application was submitted.</p>
      <p style="font-size: 15px;">
        <strong>Applicant:</strong> ${primaryFullName}<br/>
        <strong>Property:</strong> ${propertyAddress}<br/>
        ${loanType ? `<strong>Loan type:</strong> ${loanType}<br/>` : ''}
        ${amountLabel ? `<strong>Requested amount:</strong> ${amountLabel}<br/>` : ''}
        <strong>Assigned loan officer:</strong> ${loanOfficerName ?? 'Unassigned'}
      </p>
      <p style="font-size: 13px; color: #6b7280;">The application PDF is attached to this email.</p>`)
    try {
      await sendEmail({
        to: internalRecipients,
        subject: `[TEST] New loan application - ${propertyAddress}`,
        html,
        attachments: [{ filename: `Test Application - ${propertyAddress}.pdf`, content: pdf }],
      })
      result.internal = internalRecipients
    } catch (err) {
      console.error('Test internal email failed:', err)
    }
  }

  return result
}
```

- [ ] **Step 2: Type-check**

```powershell
Set-Location C:\Users\apalm\FE-Portal\feportal-apply; npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```powershell
Set-Location C:\Users\apalm\FE-Portal\feportal-apply; git add src/lib/apply-notify-test.ts; git commit -m "feat(apply): test-mode email orchestrator with inline PDF"
```

---

## Task 5: Admin-only PDF preview endpoint

**Files:**
- Create: `src/app/api/apply/test-pdf/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { renderApplicationPdf } from '@/lib/pdf/application-pdf'
import { rateLimit, clientIp } from '@/lib/rate-limit'
import type { ApplicationData } from '@/lib/application-fields'

export const runtime = 'nodejs'

async function requireAdmin(): Promise<boolean> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false
    const admin = createAdminClient()
    const { data } = await admin
      .from('admin_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle()
    return !!data
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!rateLimit(`test-pdf:${clientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  let body: { data?: ApplicationData }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  if (!body.data || typeof body.data !== 'object') {
    return NextResponse.json({ error: 'Missing data' }, { status: 400 })
  }

  const pdf = await renderApplicationPdf(body.data)
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="test-application.pdf"',
      'Cache-Control': 'no-store',
    },
  })
}
```

- [ ] **Step 2: Type-check**

```powershell
Set-Location C:\Users\apalm\FE-Portal\feportal-apply; npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```powershell
Set-Location C:\Users\apalm\FE-Portal\feportal-apply; git add src/app/api/apply/test-pdf/route.ts; git commit -m "feat(apply): admin-only test-pdf preview route"
```

---

## Task 6: Test submit endpoint

**Files:**
- Create: `src/app/api/apply/test-submit/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  BORROWER_FIELDS, PRIMARY_EXTRA_FIELDS, DEAL_FIELDS, UNIT_FIELDS,
  DECLARATION_FIELDS, HMDA_FIELDS, dscrUnitCount, isRequired,
  type ApplicationData,
} from '@/lib/application-fields'
import { renderApplicationPdf } from '@/lib/pdf/application-pdf'
import { sendApplicationTestNotifications, type TestOverrides } from '@/lib/apply-notify-test'
import { rateLimit, clientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

async function requireAdmin(): Promise<string | null> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const admin = createAdminClient()
    const { data } = await admin
      .from('admin_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle()
    return data ? user.id : null
  } catch {
    return null
  }
}

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return true
  if (Array.isArray(v) && v.length === 0) return true
  return false
}

function missingRequired(data: ApplicationData): string[] {
  const miss: string[] = []
  const primary = (data.primary as Record<string, unknown>) ?? {}
  for (const f of [...BORROWER_FIELDS, ...PRIMARY_EXTRA_FIELDS]) {
    if (isRequired(f, data, primary) && isEmpty(primary[f.name])) miss.push(`primary.${f.name}`)
  }
  for (const f of DEAL_FIELDS) {
    if (isRequired(f, data) && isEmpty(data[f.name])) miss.push(f.name)
  }
  const uc = dscrUnitCount(data)
  if (uc > 0) {
    const units = Array.isArray(data.units) ? (data.units as Record<string, unknown>[]) : []
    for (let i = 0; i < uc; i++) {
      const scope = (units[i] ?? {}) as ApplicationData
      for (const f of UNIT_FIELDS) {
        if (isRequired(f, data, scope) && isEmpty(scope[f.name as keyof typeof scope])) miss.push(`unit${i + 1}.${f.name}`)
      }
    }
  }
  const cobs: Record<string, unknown>[] = Array.isArray(data.co_borrowers)
    ? (data.co_borrowers as Record<string, unknown>[]) : []
  for (let i = 0; i < cobs.length; i++) {
    const scope = cobs[i]
    for (const f of BORROWER_FIELDS) {
      if (isRequired(f, data, scope) && isEmpty(scope[f.name])) miss.push(`coborrower${i + 1}.${f.name}`)
    }
  }
  for (const f of [...DECLARATION_FIELDS, ...HMDA_FIELDS]) {
    if (isRequired(f, data) && isEmpty(data[f.name])) miss.push(f.name)
  }
  if (isEmpty(data.auth_signature)) miss.push('auth_signature')
  return miss
}

function validEmail(s: unknown): s is string {
  return typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)
}

export async function POST(req: NextRequest) {
  const adminUserId = await requireAdmin()
  if (!adminUserId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (!rateLimit(`test-submit:${adminUserId}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: {
    data?: ApplicationData
    overrides?: Partial<TestOverrides>
    scenarioLabel?: string | null
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  if (!body.data || typeof body.data !== 'object') {
    return NextResponse.json({ error: 'Missing data' }, { status: 400 })
  }
  const o = body.overrides ?? {}
  if (!validEmail(o.borrowerEmail) || !validEmail(o.processingInbox) || !validEmail(o.loEmail)) {
    return NextResponse.json({ error: 'All three override email addresses are required and must be well-formed.' }, { status: 400 })
  }
  const overrides: TestOverrides = {
    borrowerEmail: o.borrowerEmail,
    processingInbox: o.processingInbox,
    loEmail: o.loEmail,
  }

  const miss = missingRequired(body.data)
  if (miss.length) {
    return NextResponse.json({ error: 'Some required fields are missing', missing: miss }, { status: 422 })
  }

  const pdf = await renderApplicationPdf(body.data)
  const result = await sendApplicationTestNotifications({
    data: body.data,
    pdf,
    overrides,
    scenarioLabel: typeof body.scenarioLabel === 'string' ? body.scenarioLabel : null,
  })

  return NextResponse.json({
    success: true,
    recipients: { borrower: result.borrower, internal: result.internal },
    pdfBytes: result.pdfBytes,
    scenario: body.scenarioLabel ?? null,
  })
}
```

- [ ] **Step 2: Type-check**

```powershell
Set-Location C:\Users\apalm\FE-Portal\feportal-apply; npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```powershell
Set-Location C:\Users\apalm\FE-Portal\feportal-apply; git add src/app/api/apply/test-submit/route.ts; git commit -m "feat(apply): admin-only test-submit route (no writes, full notify path)"
```

---

## Task 7: Test confirmation page

**Files:**
- Create: `src/app/apply/test-submitted/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'

interface TestResult {
  scenario: string | null
  recipients: { borrower: string | null; internal: string[] }
  pdfBytes: number
  data: unknown
}

export default function TestSubmittedPage() {
  const [result, setResult] = useState<TestResult | null>(null)
  const [redownloading, setRedownloading] = useState(false)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('fe-apply-test-result')
      if (raw) setResult(JSON.parse(raw) as TestResult)
    } catch { /* ignore */ }
  }, [])

  async function redownloadPdf() {
    if (!result) return
    setRedownloading(true)
    try {
      const res = await fetch('/api/apply/test-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: result.data }),
      })
      if (!res.ok) { toast.error('Could not re-render the PDF'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'test-application.pdf'
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setRedownloading(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Test mode submission</strong> - nothing was written to live loans, borrowers, or storage.
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="mb-2 text-2xl font-semibold text-[#1F5D8F]">Test application processed</h1>

        {!result ? (
          <p className="text-slate-600">No test result found in this session. Start a new test from <Link href="/apply" className="font-medium text-[#1F5D8F] underline">/apply</Link>.</p>
        ) : (
          <>
            <dl className="my-6 space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Scenario</dt>
                <dd className="font-medium text-slate-900">{result.scenario ?? '-'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Borrower email</dt>
                <dd className="font-medium text-slate-900">{result.recipients.borrower ?? 'not sent'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Internal email recipients</dt>
                <dd className="font-medium text-slate-900 text-right">
                  {result.recipients.internal.length > 0
                    ? result.recipients.internal.join(', ')
                    : 'not sent'}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">PDF size</dt>
                <dd className="font-medium text-slate-900">{result.pdfBytes.toLocaleString()} bytes</dd>
              </div>
            </dl>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={redownloadPdf}
                disabled={redownloading}
                className="inline-flex h-10 items-center rounded-md border border-[#1F5D8F] px-4 text-sm font-semibold text-[#1F5D8F] hover:bg-[#1F5D8F]/5 disabled:opacity-60"
              >
                {redownloading ? 'Re-rendering…' : 'Re-download PDF'}
              </button>
              <Link
                href="/apply"
                className="inline-flex h-10 items-center rounded-md bg-[#1F5D8F] px-4 text-sm font-semibold text-white hover:bg-[#0F3A5E]"
              >
                Run another test
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```powershell
Set-Location C:\Users\apalm\FE-Portal\feportal-apply; npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```powershell
Set-Location C:\Users\apalm\FE-Portal\feportal-apply; git add src/app/apply/test-submitted/page.tsx; git commit -m "feat(apply): test confirmation page with redownload"
```

---

## Task 8: Autosave disable flag

**Files:**
- Modify: `src/app/apply/_components/use-autosave.ts`

- [ ] **Step 1: Add the disable flag**

Replace the function signature and effect body:

```ts
'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

export type AutosaveStatus =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved'; at: number }
  | { state: 'error'; message: string }

/** Debounced PATCH to /api/apply/draft. No-op until a resumeToken exists,
 *  or when `disabled` is true (used by test mode to keep nothing written
 *  to loan_applications). */
export function useAutosave(
  resumeToken: string | null,
  data: unknown,
  currentStep: number,
  disabled = false,
): AutosaveStatus {
  const [status, setStatus] = useState<AutosaveStatus>({ state: 'idle' })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const save = useCallback(async (token: string) => {
    setStatus({ state: 'saving' })
    try {
      const res = await fetch('/api/apply/draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeToken: token, data, currentStep }),
      })
      if (res.ok) {
        setStatus({ state: 'saved', at: Date.now() })
      } else {
        setStatus({ state: 'error', message: `HTTP ${res.status}` })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed'
      setStatus({ state: 'error', message })
    }
  }, [data, currentStep])

  useEffect(() => {
    if (disabled) return
    if (!resumeToken) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      save(resumeToken)
    }, 1500)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [resumeToken, save, disabled])

  return status
}
```

- [ ] **Step 2: Type-check**

```powershell
Set-Location C:\Users\apalm\FE-Portal\feportal-apply; npx tsc --noEmit
```

Expected: zero errors (existing 3-arg call site in `wizard.tsx` still works because `disabled` defaults to `false`).

- [ ] **Step 3: Commit**

```powershell
Set-Location C:\Users\apalm\FE-Portal\feportal-apply; git add src/app/apply/_components/use-autosave.ts; git commit -m "feat(apply): useAutosave accepts a disabled flag"
```

---

## Task 9: Test mode panel component

**Files:**
- Create: `src/app/apply/_components/test-mode-panel.tsx`

- [ ] **Step 1: Write the panel**

```tsx
'use client'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { SCENARIO_OPTIONS, buildScenario, type ScenarioKey } from '@/lib/test-data/scenarios'
import { TOTAL_STEPS, type ApplicationData } from '@/lib/application-fields'

const DEFAULT_EMAIL = 'apalmiotto@outlook.com'

export interface TestOverridesState {
  borrowerEmail: string
  processingInbox: string
  loEmail: string
}

const DEFAULT_OVERRIDES: TestOverridesState = {
  borrowerEmail: DEFAULT_EMAIL,
  processingInbox: DEFAULT_EMAIL,
  loEmail: DEFAULT_EMAIL,
}

function loadOverrides(): TestOverridesState {
  if (typeof window === 'undefined') return DEFAULT_OVERRIDES
  try {
    const raw = window.localStorage.getItem('fe-apply-test-overrides')
    if (!raw) return DEFAULT_OVERRIDES
    const parsed = JSON.parse(raw) as Partial<TestOverridesState>
    return {
      borrowerEmail: parsed.borrowerEmail ?? DEFAULT_EMAIL,
      processingInbox: parsed.processingInbox ?? DEFAULT_EMAIL,
      loEmail: parsed.loEmail ?? DEFAULT_EMAIL,
    }
  } catch {
    return DEFAULT_OVERRIDES
  }
}

export function TestModePanel(props: {
  data: ApplicationData
  setData: (next: ApplicationData) => void
  step: number
  setStep: (n: number) => void
  onAutoSubmit: (overrides: TestOverridesState, scenarioLabel: string, scenarioData: ApplicationData) => Promise<void>
  busy: boolean
}) {
  const { data, setData, step, setStep, onAutoSubmit, busy } = props
  const [scenario, setScenario] = useState<ScenarioKey>('fix-flip-purchase')
  const [overrides, setOverrides] = useState<TestOverridesState>(DEFAULT_OVERRIDES)

  useEffect(() => { setOverrides(loadOverrides()) }, [])

  function persist(next: TestOverridesState) {
    setOverrides(next)
    try { window.localStorage.setItem('fe-apply-test-overrides', JSON.stringify(next)) } catch { /* ignore */ }
  }

  function scenarioLabel(): string {
    return SCENARIO_OPTIONS.find(s => s.key === scenario)?.label ?? scenario
  }

  function fillWithScenario() {
    const built = buildScenario(scenario)
    setData(built)
    toast.success(`Filled with ${scenarioLabel()}`)
  }

  async function previewPdf() {
    try {
      const res = await fetch('/api/apply/test-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      })
      if (!res.ok) { toast.error('PDF preview failed'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'test-application.pdf'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('PDF preview failed')
    }
  }

  async function autoSubmit() {
    const built = buildScenario(scenario)
    setData(built)
    await onAutoSubmit(overrides, scenarioLabel(), built)
  }

  return (
    <div className="mb-6 rounded-md border-2 border-amber-300 bg-amber-50 p-4 text-sm">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-semibold text-amber-900">Test mode controls</p>
        <p className="text-xs text-amber-800">Admin only - no live writes</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-amber-900">Scenario</span>
          <select
            value={scenario}
            onChange={(e) => setScenario(e.target.value as ScenarioKey)}
            className="rounded-md border border-amber-300 bg-white px-2 py-1 text-sm"
          >
            {SCENARIO_OPTIONS.map(o => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-amber-900">Skip to step</span>
          <div className="flex gap-1">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map(n => (
              <button
                key={n}
                type="button"
                onClick={() => setStep(n)}
                className={`h-8 w-8 rounded-md text-xs font-semibold ${
                  step === n
                    ? 'bg-[#1F5D8F] text-white'
                    : 'border border-amber-300 bg-white text-amber-900 hover:bg-amber-100'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-amber-900">Borrower email</span>
          <input
            type="email"
            value={overrides.borrowerEmail}
            onChange={(e) => persist({ ...overrides, borrowerEmail: e.target.value })}
            className="rounded-md border border-amber-300 bg-white px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-amber-900">Processing inbox</span>
          <input
            type="email"
            value={overrides.processingInbox}
            onChange={(e) => persist({ ...overrides, processingInbox: e.target.value })}
            className="rounded-md border border-amber-300 bg-white px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-xs font-medium text-amber-900">Loan officer email</span>
          <input
            type="email"
            value={overrides.loEmail}
            onChange={(e) => persist({ ...overrides, loEmail: e.target.value })}
            className="rounded-md border border-amber-300 bg-white px-2 py-1 text-sm"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={fillWithScenario}
          disabled={busy}
          className="inline-flex h-9 items-center rounded-md bg-amber-600 px-3 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
        >
          Fill with test data
        </button>
        <button
          type="button"
          onClick={previewPdf}
          disabled={busy}
          className="inline-flex h-9 items-center rounded-md border border-amber-600 bg-white px-3 text-sm font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
        >
          PDF preview
        </button>
        <button
          type="button"
          onClick={autoSubmit}
          disabled={busy}
          className="inline-flex h-9 items-center rounded-md bg-[#1F5D8F] px-3 text-sm font-semibold text-white hover:bg-[#0F3A5E] disabled:opacity-50"
        >
          Auto-submit
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```powershell
Set-Location C:\Users\apalm\FE-Portal\feportal-apply; npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```powershell
Set-Location C:\Users\apalm\FE-Portal\feportal-apply; git add src/app/apply/_components/test-mode-panel.tsx; git commit -m "feat(apply): test mode control panel"
```

---

## Task 10: Wire wizard to test mode

This is the largest edit. Mounting order matters: the toggle must only render when `isAdmin`, the panel only when `testMode`, and the submit path must branch *only* when `testMode` is on.

**Files:**
- Modify: `src/app/apply/_components/wizard.tsx`

- [ ] **Step 1: Add imports and test-mode state**

At the top of `wizard.tsx`, add:

```tsx
import { TestModePanel, type TestOverridesState } from './test-mode-panel'
```

Inside the `Wizard` component body (after the existing `const [submitErrors, ...]` line), add:

```tsx
const [testMode, setTestMode] = useState(false)
const [testSubmitting, setTestSubmitting] = useState(false)

// Load + persist test mode toggle (admins only).
useEffect(() => {
  if (!isAdmin) return
  try {
    const raw = window.localStorage.getItem('fe-apply-test-mode')
    if (raw === '1') setTestMode(true)
  } catch { /* ignore */ }
}, [isAdmin])
useEffect(() => {
  if (!isAdmin) return
  try { window.localStorage.setItem('fe-apply-test-mode', testMode ? '1' : '0') } catch { /* ignore */ }
}, [testMode, isAdmin])

// Persist current data to localStorage while test mode is on (autosave is suppressed).
useEffect(() => {
  if (!testMode) return
  try { window.localStorage.setItem('fe-apply-test-data', JSON.stringify(data)) } catch { /* ignore */ }
}, [data, testMode])
useEffect(() => {
  if (!isAdmin || !testMode) return
  try {
    const raw = window.localStorage.getItem('fe-apply-test-data')
    if (raw) setData(JSON.parse(raw) as ApplicationData)
  } catch { /* ignore */ }
  // Intentionally only on toggle-on transitions.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [testMode])
```

- [ ] **Step 2: Pass `disabled` to useAutosave and add ensureDraft no-op in test mode**

Change:

```tsx
const autosaveStatus = useAutosave(token, data, step)
```

to:

```tsx
const autosaveStatus = useAutosave(token, data, step, testMode)
```

Change the `ensureDraft` body to early-return in test mode:

```tsx
const ensureDraft = useCallback(async (email: string, firstName: string) => {
  if (testMode) return
  if (token || !email) return
  try {
    const res = await fetch('/api/apply/draft', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, firstName, data }),
    })
    const j = await res.json()
    if (j.success) { setToken(j.resumeToken); toast.success('Progress saved. A resume link was emailed to you.') }
    else toast.error(j.error ?? 'Could not start application')
  } catch { toast.error('Network error - please try again') }
}, [token, data, testMode])
```

- [ ] **Step 3: Add the test-mode submit helper**

Below the existing `submit()` function, add:

```tsx
async function testSubmit(overrides: TestOverridesState, scenarioLabel: string, submissionData: ApplicationData) {
  setTestSubmitting(true)
  setSubmitErrors(null)
  try {
    const res = await fetch('/api/apply/test-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: submissionData, overrides, scenarioLabel }),
    })
    const j = await res.json()
    if (j.success) {
      try {
        sessionStorage.setItem('fe-apply-test-result', JSON.stringify({
          scenario: j.scenario,
          recipients: j.recipients,
          pdfBytes: j.pdfBytes,
          data: submissionData,
        }))
      } catch { /* ignore */ }
      window.location.href = '/apply/test-submitted'
      return
    }
    if (!res.ok && Array.isArray(j.missing) && j.missing.length > 0) {
      setSubmitErrors(j.missing)
      toast.error(`${j.missing.length} required field${j.missing.length === 1 ? '' : 's'} missing`)
      return
    }
    toast.error(j.error ?? 'Test submit failed')
  } catch {
    toast.error('Network error - please try again')
  } finally {
    setTestSubmitting(false)
  }
}
```

- [ ] **Step 4: Route the final-step Submit button to the test path when test mode is on**

Find the final-step submit button (the `else` branch where `step < TOTAL_STEPS` is false) and replace its `onClick={submit}` and disabled logic:

```tsx
<button
  type="button"
  onClick={async () => {
    if (testMode) {
      const overridesRaw = (() => {
        try { return JSON.parse(window.localStorage.getItem('fe-apply-test-overrides') ?? 'null') } catch { return null }
      })() as TestOverridesState | null
      const overrides: TestOverridesState = overridesRaw ?? {
        borrowerEmail: 'apalmiotto@outlook.com',
        processingInbox: 'apalmiotto@outlook.com',
        loEmail: 'apalmiotto@outlook.com',
      }
      await testSubmit(overrides, 'Manual submit', data)
    } else {
      submit()
    }
  }}
  disabled={testMode ? testSubmitting : (submitting || !token)}
  className="inline-flex h-11 items-center rounded-md bg-[#1F5D8F] px-6 text-base font-semibold text-white transition-colors hover:bg-[#0F3A5E] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60"
>
  {testMode ? (testSubmitting ? 'Submitting…' : 'Submit Test Application') : (submitting ? 'Submitting…' : 'Submit Application')}
</button>
```

- [ ] **Step 5: Add the top-of-page test mode banner + toggle + panel mount**

Immediately inside the outer `<div className="mx-auto max-w-4xl px-6 py-8">`, *before* the existing `devSkipRequired` block, add:

```tsx
{isAdmin && (
  <div className="mb-3 flex items-center justify-end gap-2">
    <span className="text-xs font-medium text-gray-500">Test mode</span>
    <button
      type="button"
      role="switch"
      aria-checked={testMode}
      onClick={() => setTestMode(t => !t)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${testMode ? 'bg-amber-600' : 'bg-gray-300'}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${testMode ? 'translate-x-5' : 'translate-x-1'}`}
      />
    </button>
  </div>
)}

{testMode && (
  <div role="alert" className="mb-4 rounded-md border-2 border-amber-400 bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-900">
    TEST MODE - submissions will not be saved to live records.
  </div>
)}

{testMode && (
  <TestModePanel
    data={data}
    setData={(next) => setData(next)}
    step={step}
    setStep={(n) => { setSubmitErrors(null); setStep(n); setMaxVisited(m => Math.max(m, n)) }}
    onAutoSubmit={(overrides, label, scenarioData) => testSubmit(overrides, label, scenarioData)}
    busy={testSubmitting}
  />
)}
```

- [ ] **Step 6: Type-check**

```powershell
Set-Location C:\Users\apalm\FE-Portal\feportal-apply; npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```powershell
Set-Location C:\Users\apalm\FE-Portal\feportal-apply; git add src/app/apply/_components/wizard.tsx; git commit -m "feat(apply): wire wizard to test mode toggle, panel, and submit"
```

---

## Task 11: Final verification

- [ ] **Step 1: Production build**

```powershell
Set-Location C:\Users\apalm\FE-Portal\feportal-apply; npm run build
```

Expected: build succeeds; no type errors; route summary lists both `/apply/test-submitted` and `/api/apply/test-pdf` and `/api/apply/test-submit`.

- [ ] **Step 2: Start the dev server on port 3100 and verify manually**

```powershell
Set-Location C:\Users\apalm\FE-Portal\feportal-apply; npm run dev -- -p 3100
```

In a browser, walk these checks. For each item, capture the result before moving on.

1. **Anonymous (no session) at `http://localhost:3100/apply`** - page renders today's wizard. No toggle visible. No banner. `localStorage` has no `fe-apply-test-*` keys created.
2. **Admin login** in another tab; return to `/apply`. The "Test mode" toggle appears top-right; toggle is OFF; wizard behaves exactly as before.
3. **Flip the toggle ON.** The yellow "TEST MODE" banner appears. The panel renders. Browser console is clean. Refresh the page - toggle is still ON (persistence works).
4. **Pick "Fix & Flip Purchase" and click "Fill with test data".** All five steps populate. Use the step shortcuts to spot-check that every required field is filled.
5. **Click "PDF preview".** A PDF named `test-application.pdf` downloads. Open it - applicant name + property + SSN masked (`XXX-XX-####`) are visible. No 4xx/5xx in the Network tab.
6. **Click "Auto-submit".** You land on `/apply/test-submitted`. The card lists the chosen scenario, three recipient addresses, and a non-zero PDF byte count. Click "Re-download PDF" and verify it downloads.
7. **Check the inbox at `apalmiotto@outlook.com`.** Two emails arrived: subjects `[TEST] We received your First Equity loan application` and `[TEST] New loan application - <address>`. The internal email has the PDF attached. The borrower email has the "Test mode - activation link not generated" notice.
8. **Negative checks (DB hygiene).** Probe Supabase via REST (use the service-role key from `.env.local`; if `.env.local` was scrubbed, copy from the main `feportal/.env.local`). Confirm: no new rows in `loan_applications`, `loans`, `borrowers`, `loan_details`, `loan_demographics`, `loan_events`, or `documents`. No new `auth.users` entry. No file in `storage` under `loans/...`. (Use the same REST patterns from the PR #8 e2e: `GET {url}/rest/v1/<table>?order=created_at.desc&limit=5` with `apikey` + `Authorization: Bearer <service-role>`.)
9. **Regression (toggle off).** Flip the toggle off, manually fill Step 1 with a real-looking email, walk through to Step 5, submit. Confirm the real `/apply/submitted` page renders and the prod orchestrator emails arrive (one real row will be created; clean it up via the same delete order documented in the handoff: `documents -> loan_events -> loan_demographics -> loan_details -> loans -> loan_applications -> borrowers`, then the storage object).
10. **Non-admin double-check.** In an incognito window or with a non-admin account, open `/apply`. No toggle, no panel, no banner. `Network` tab shows no calls to `/api/apply/test-*`. Try POSTing directly to `/api/apply/test-submit` from the console - expect `403`.

- [ ] **Step 3: Commit if any documentation files were touched**

If only code changed and all per-task commits succeeded, there is nothing to commit here. Otherwise:

```powershell
Set-Location C:\Users\apalm\FE-Portal\feportal-apply; git status
```

Inspect; commit any leftovers with a clear message.

- [ ] **Step 4: Done**

Branch `feature/apply-test-mode` is ready for review. Open a draft PR stacked on `feature/apply-confirmation-pdf`:

```powershell
Set-Location C:\Users\apalm\FE-Portal\feportal-apply; gh pr create --draft --base feature/apply-confirmation-pdf --title "Apply: admin test mode" --body "Implements docs/superpowers/specs/2026-05-26-apply-test-mode-design.md. Stacked on PR #8."
```

Report the PR URL to the user.

---

## Risk reminders for the engineer

- **Do not call the prod submit route from the test path.** `/api/apply/submit` writes to `loans`, `borrowers`, `documents`, `loan_applications`, and `auth.users` via the after-hook. The whole point of test mode is that none of this runs.
- **Do not import `apply-notify.ts` from the test orchestrator.** Keep `apply-notify-test.ts` independent so a future change to the prod orchestrator can't accidentally re-enable storage writes in test mode.
- **`Buffer` in the API response.** `renderApplicationPdf` returns a Node `Buffer`. Wrap it in `new Uint8Array(buf)` before passing to `NextResponse` so the body type is portable.
- **Override email validation lives on the server.** Even though the panel collects them client-side, the server route rejects malformed addresses with a 400. Never trust the client.
- **Rate limit key for `test-submit` is the admin user id, not the IP**, because admin sessions on the same office IP would otherwise share a bucket.
