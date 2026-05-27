# Loan Application Intake — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public 6-step loan application form that saves drafts server-side (resume by emailed link), collects a Square card-on-file, and on submit creates the canonical `borrowers`/`loans`/`loan_details`/`loan_demographics` rows the existing portal already reads — Supabase-native, no Pipedrive.

**Architecture:** A new `loan_applications` table holds the entire form as `jsonb` while in `draft`; on `submit` a pure mapper (`application-mapper.ts`) transforms it into the existing portal tables. The form is **data-driven**: one centralized config (`application-fields.ts`) declares every field, its options, and its `visibleWhen` rule; a generic `<FieldRenderer>` renders from that config, so step components stay thin and conditional logic lives in exactly one place. Square Web Payments SDK tokenizes the card client-side; the server only stores Square customer/card IDs + the computed fee.

**Tech Stack:** Next.js 16 App Router (Server + Client Components), Supabase (`@supabase/supabase-js` service-role), TypeScript, Tailwind v4 + shadcn/base-ui components, `sonner` toasts, `nodemailer` (Gmail), Square Node SDK + Web Payments SDK. No test framework — **`npm run build` (tsc + ESLint) is the correctness gate**; UI is verified with the Playwright MCP.

**Companion spec:** `docs/superpowers/specs/2026-05-19-loan-application-intake-design.md` — the authoritative field inventory (§5) and option lists (§5.1). This plan references it; keep it open.

**Branch:** `feature/loan-application-intake` (already created).

---

## ⚠️ Production-Sensitive Surface — read before starting

This feature touches **payments and PII**:
- Public unauthenticated endpoints (`/api/apply/*`) accept SSN/DOB.
- Square card-on-file creation.
- Draft rows hold PII indefinitely (product decision; no auto-delete).

Consequences enforced by this plan:
- Every `/api/apply/*` route uses the **service-role** client only, never logs `data`, validates inputs, and is rate-limited (Task 5).
- Card data never reaches our server (Square Web SDK tokenizes client-side; Task 13).
- A dedicated **security review** (Task 16) and an **end-to-end Playwright verification** (Task 15) are mandatory before the branch is finished. Do not skip them.

---

## Dependency Graph (for parallel execution)

```
Task 1 (migration+types) ─┬─> Task 5 (draft API) ──> Task 7 (submit API) ──> Task 15 (E2E verify)
                          ├─> Task 6 (mapper) ──────> Task 7
                          ├─> Task 8 (payment API) ─> Task 15
                          └─> Task 11 (admin charge) > Task 15
Task 2 (Square lib)  ─────┴─> Task 8, Task 11, Task 13
Task 3 (field config) ────┬─> Task 6, Task 9, Task 10, Task 12, Task 13
Task 4 (email fns)   ─────┴─> Task 7
Task 9 (wizard shell+renderer) ──> Task 10/12/13 (steps) ──> Task 14 (apply route+resume) ──> Task 15
Task 16 (cron guard)  — independent
Task 17 (security review) — last
```

**Independent, can run in parallel first:** Tasks 1, 2, 3, 4, 16.
After Task 1: 5, 6, 8, 11 in parallel. After Task 3: 9. UI steps (10/12/13) after 9.

---

## Task 1: Database migration + types

**Files:**
- Create: `supabase/migrations/20260519-loan-applications.sql`
- Modify: `supabase/schema.sql:140` (drop NOT NULL on `loans.pipedrive_deal_id`)
- Modify: `src/lib/types.ts` (append `LoanApplication` interface + option-list constants source note)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260519-loan-applications.sql`:

```sql
-- Loan Application intake (Supabase-native; replaces JotForm path).
-- Idempotent: safe to re-run.

-- 1. App-created loans have no Pipedrive deal — allow NULL.
alter table loans alter column pipedrive_deal_id drop not null;

-- 2. Draft/intake table. `data` jsonb holds the entire form while draft.
create table if not exists loan_applications (
  id uuid primary key default uuid_generate_v4(),
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  current_step int not null default 1 check (current_step between 1 and 6),
  resume_token uuid not null default uuid_generate_v4(),
  resume_email text,
  data jsonb not null default '{}'::jsonb,
  square_customer_id text,
  square_card_id text,
  card_brand text,
  card_last4 text,
  fee_amount_cents int,
  fee_charged_at timestamptz,
  submitted_loan_id uuid references loans(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists loan_applications_resume_token_idx
  on loan_applications(resume_token);
create index if not exists loan_applications_status_idx
  on loan_applications(status);
create index if not exists loan_applications_submitted_loan_idx
  on loan_applications(submitted_loan_id);

-- 3. RLS: anon fully denied; only service-role (createAdminClient) touches it.
alter table loan_applications enable row level security;
-- (no policies = default deny for anon/authenticated)

-- 4. updated_at trigger (reuses existing function).
drop trigger if exists update_loan_applications_updated_at on loan_applications;
create trigger update_loan_applications_updated_at
  before update on loan_applications
  for each row execute function update_updated_at_column();
```

- [ ] **Step 2: Apply the migration to Supabase**

Run it via the Supabase MCP `apply_migration` tool (name: `loan_applications`, the SQL above) OR paste into the Supabase SQL Editor. Confirm the table exists:

Run (Supabase MCP `execute_sql`): `select count(*) from loan_applications;`
Expected: returns `0` (table exists, empty).

- [ ] **Step 3: Update `schema.sql` so fresh installs match**

In `supabase/schema.sql`, line 140, change:
```sql
  pipedrive_deal_id integer unique not null,
```
to:
```sql
  pipedrive_deal_id integer unique,   -- nullable: app-created loans have no Pipedrive deal
```
Then append the full `loan_applications` table block (same DDL as Step 1, minus the `alter loans`) to the end of the "Audit & intake" section near `loan_demographics` (after line 408), and add `loan_applications` to the RLS `enable row level security` block (around line 462).

- [ ] **Step 4: Add types**

Append to `src/lib/types.ts`:

```ts
export type LoanApplicationStatus = 'draft' | 'submitted'

export interface LoanApplication {
  id: string
  status: LoanApplicationStatus
  current_step: number
  resume_token: string
  resume_email: string | null
  data: Record<string, unknown>
  square_customer_id: string | null
  square_card_id: string | null
  card_brand: string | null
  card_last4: string | null
  fee_amount_cents: number | null
  fee_charged_at: string | null
  submitted_loan_id: string | null
  created_at: string
  updated_at: string
}

// Maps the form's Loan Type display label → existing loans.loan_type CHECK value.
export const APPLICATION_LOAN_TYPE_MAP: Record<string, LoanType> = {
  'Fix & Flip/Renovation': 'Fix & Flip (Bridge)',
  'New Construction':       'New Construction',
  'DSCR Rental Loan':       'Rental (DSCR)',
}
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: PASS (no TS/ESLint errors). Types compile.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260519-loan-applications.sql supabase/schema.sql src/lib/types.ts
git commit -m "feat(apply): loan_applications table + nullable pipedrive_deal_id + types"
```

---

## Task 2: Square SDK + library wrapper

**Files:**
- Modify: `package.json` (add `square`)
- Create: `src/lib/square.ts`
- Modify: `.env.local` (document new vars — do not commit secrets)

- [ ] **Step 1: Install the Square SDK**

Run: `npm install square`
Expected: `square` appears in `package.json` dependencies.

- [ ] **Step 2: Write the server wrapper**

Create `src/lib/square.ts`:

```ts
import { SquareClient, SquareEnvironment } from 'square'

/** Server-side Square client. Never import in a Client Component. */
export function squareClient() {
  const token = process.env.SQUARE_ACCESS_TOKEN
  if (!token) throw new Error('SQUARE_ACCESS_TOKEN not set')
  return new SquareClient({
    token,
    environment:
      process.env.SQUARE_ENVIRONMENT === 'production'
        ? SquareEnvironment.Production
        : SquareEnvironment.Sandbox,
  })
}

export const SQUARE_LOCATION_ID = () => {
  const id = process.env.SQUARE_LOCATION_ID
  if (!id) throw new Error('SQUARE_LOCATION_ID not set')
  return id
}

/** $45 per borrower (primary + co-borrowers), structurally capped at 4. */
export function feeCentsForBorrowerCount(count: number): number {
  const n = Math.max(1, Math.min(4, count))
  return n * 4500
}
```

- [ ] **Step 3: Document env vars**

Append to `.env.local` (local only — these are NOT committed; also add to Vercel project env):

```
NEXT_PUBLIC_SQUARE_APPLICATION_ID=
SQUARE_ACCESS_TOKEN=
SQUARE_LOCATION_ID=
SQUARE_ENVIRONMENT=sandbox
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: PASS. (`feeCentsForBorrowerCount` is unused for now — that's fine, it's exported.)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/square.ts
git commit -m "feat(apply): add Square SDK + server wrapper + fee helper"
```

---

## Task 3: Centralized field config + conditional-logic engine

**Files:**
- Create: `src/lib/application-fields.ts`

This is the single source of truth for every field, option list, and visibility rule. Step components and the mapper read from it.

- [ ] **Step 1: Write the config module**

Create `src/lib/application-fields.ts`. Use the **exact** option lists from spec §5.1 and the field inventory from spec §5. Structure:

```ts
// Centralized field + conditional-logic config for the loan application.
// One source of truth: render order, options, and visibility rules.

export type FieldType =
  | 'text' | 'email' | 'tel' | 'ssn' | 'date' | 'number' | 'currency'
  | 'select' | 'radio' | 'yesno' | 'textarea' | 'file'

export type ApplicationData = Record<string, unknown>

export interface FieldDef {
  /** Unique key within its section/repeat scope; also the data key. */
  name: string
  label: string
  type: FieldType
  required?: boolean
  options?: readonly string[]
  placeholder?: string
  help?: string
  /** Show only when this predicate is true. Absent = always visible. */
  visibleWhen?: (d: ApplicationData, scope?: ApplicationData) => boolean
  /** Required only when true (in addition to `required`). */
  requiredWhen?: (d: ApplicationData, scope?: ApplicationData) => boolean
}

// ---- Option lists (spec §5.1 — confirmed final) ----
export const CREDIT_SCORE_OPTIONS = ['> 780','760-779','740-759','720-739','700-719','680-699','660-679','640-659','620-639','600-619','< 599'] as const
export const LOAN_TYPE_OPTIONS = ['Fix & Flip/Renovation','New Construction','DSCR Rental Loan'] as const
export const PROPERTY_TYPE_OPTIONS = ['Single Family','Condo','Multifamily (2-4 Units)','Multifamily (5+ Units)','Mixed Use','Other Commercial'] as const
export const EXIT_STRATEGY_OPTIONS = ['Sell','Refinance','Other (Explain Below)'] as const
export const DEAL_SOURCE_OPTIONS = ['Short Sale','Bank Owned (REO)','Sheriff Sale','MLS','Foreclosure Auction','Wholesaler','Direct from Seller','Other'] as const
export const HEAR_ABOUT_OPTIONS = ['Internet Search (Google, Bing, etc.)','Social Media (Facebook, Instagram, etc.)','YouTube','Email Marketing','Text Message','Phone Call','Direct Mail','Networking Event','Realtor Referral','Broker Referral','Other Referral','3rd Party Website','3rd Party Publication','Other'] as const
export const LEASE_TYPE_OPTIONS = ['Annual','Month-to-Month','Short Term/Vacation Rental','Vacant'] as const
export const OTHER_RE_EXPERIENCE_OPTIONS = ['Realtor','Contractor','Wholesaler','Real Estate Attorney','Mortgage Broker/Lender'] as const
export const FLIPS_COMPLETED_OPTIONS = ['0','1 - 2','3 - 10','11+'] as const
export const MARITAL_STATUS_OPTIONS = ['Married','Single','Separated'] as const
export const PURCHASE_REFI_OPTIONS = ['Purchase','Refinance','Cash-Out Refinance'] as const
export const HOUSING_STATUS_OPTIONS = ['Own','Rent'] as const
export const ENTITY_TYPE_OPTIONS = ['LLC','Corporation','Limited Partnership','Other'] as const
export const HMDA_ETHNICITY_OPTIONS = ['Hispanic or Latino','Not Hispanic or Latino','I do not wish to provide this information'] as const
export const HMDA_RACE_OPTIONS = ['American Indian or Alaska Native','Asian','Black or African American','Native Hawaiian or Other Pacific Islander','White','Other','I do not wish to provide this information'] as const
export const HMDA_SEX_OPTIONS = ['Male','Female','I do not wish to provide this information'] as const

// Per-borrower field set (used for primary + each co-borrower; `scope` = that borrower's sub-object)
export const BORROWER_FIELDS: FieldDef[] = [
  { name: 'first_name', label: 'First Name', type: 'text', required: true },
  { name: 'middle_name', label: 'Middle Name', type: 'text' },
  { name: 'last_name', label: 'Last Name', type: 'text', required: true },
  { name: 'dob', label: 'Date of Birth', type: 'date', required: true },
  { name: 'ssn', label: 'Social Security Number', type: 'ssn', required: true },
  { name: 'us_citizen', label: 'U.S. Citizen?', type: 'yesno', required: true },
  { name: 'permanent_resident_alien', label: 'Permanent Resident Alien?', type: 'yesno', required: true },
  { name: 'foreign_national', label: 'Foreign National?', type: 'yesno', required: true },
  { name: 'legal_status', label: 'What is your current legal status?', type: 'text' },
  { name: 'marital_status', label: 'Marital Status', type: 'select', options: MARITAL_STATUS_OPTIONS },
  { name: 'email', label: 'Email', type: 'email', required: true },
  { name: 'cell_phone', label: 'Cell Phone', type: 'tel', required: true },
  { name: 'other_phone', label: 'Other Phone', type: 'tel' },
  { name: 'credit_score', label: 'Estimated Credit Score', type: 'select', options: CREDIT_SCORE_OPTIONS, required: true },
  { name: 'address_street', label: 'Address Line 1', type: 'text', required: true },
  { name: 'address_city', label: 'City', type: 'text', required: true },
  { name: 'address_state', label: 'State', type: 'text', required: true },
  { name: 'address_zip', label: 'Zip Code', type: 'text', required: true },
  { name: 'lived_2y', label: 'Have you lived here for two years?', type: 'yesno', required: true },
  { name: 'prior_address_street', label: 'Prior Address Line 1', type: 'text',
    visibleWhen: (_d, s) => s?.lived_2y === false, requiredWhen: (_d, s) => s?.lived_2y === false },
  { name: 'prior_address_city', label: 'Prior City', type: 'text',
    visibleWhen: (_d, s) => s?.lived_2y === false },
  { name: 'prior_address_state', label: 'Prior State', type: 'text',
    visibleWhen: (_d, s) => s?.lived_2y === false },
  { name: 'prior_address_zip', label: 'Prior Zip', type: 'text',
    visibleWhen: (_d, s) => s?.lived_2y === false },
]

// Per-borrower experience fields (Step 3)
export const EXPERIENCE_FIELDS: FieldDef[] = [
  { name: 'flips_last_3y', label: 'Fix & Flips / Fix & Holds Completed Last 3 Years', type: 'select', options: FLIPS_COMPLETED_OPTIONS },
  { name: 'rental_units_owned', label: 'Number of Rental Units Currently Owned', type: 'number' },
  { name: 'other_re_experience', label: 'Other Real Estate Experience', type: 'select', options: OTHER_RE_EXPERIENCE_OPTIONS },
  { name: 'experience_explanation', label: 'Experience Explanation', type: 'textarea' },
]

// Per-borrower declarations (Step 4) — all yes/no
export const DECLARATION_FIELDS: FieldDef[] = [
  { name: 'd_liens', label: 'Do you have any outstanding liens or judgements against you?', type: 'yesno', required: true },
  { name: 'd_bankruptcy', label: 'Have you declared bankruptcy or had a foreclosure in the past 4 years?', type: 'yesno', required: true },
  { name: 'd_delinquent', label: 'Are you presently delinquent on any debt, lien, mortgage or financial obligation?', type: 'yesno', required: true },
  { name: 'd_foreclosure_obligation', label: 'Have you directly or indirectly been obligated on any loan which resulted in foreclosure, transfer of title in lieu of foreclosure, or judgement?', type: 'yesno', required: true },
  { name: 'd_lawsuit', label: 'Are you a party to a lawsuit?', type: 'yesno', required: true },
  { name: 'd_down_payment_borrowed', label: 'Is any part of the down payment borrowed?', type: 'yesno', required: true },
  { name: 'd_us_citizen', label: 'Are you a US Citizen?', type: 'yesno', required: true },
  { name: 'd_permanent_resident', label: 'Are you a permanent resident alien?', type: 'yesno', required: true },
  { name: 'd_foreign_national', label: 'Are you a foreign national?', type: 'yesno', required: true },
  { name: 'd_intent_to_occupy', label: 'Do you intend to occupy the subject property?', type: 'yesno', required: true },
]

// Per-borrower HMDA (Step 4)
export const HMDA_FIELDS: FieldDef[] = [
  { name: 'hmda_ethnicity', label: 'Ethnicity', type: 'radio', options: HMDA_ETHNICITY_OPTIONS, required: true },
  { name: 'hmda_race', label: 'Race', type: 'radio', options: HMDA_RACE_OPTIONS, required: true },
  { name: 'hmda_sex', label: 'Sex', type: 'radio', options: HMDA_SEX_OPTIONS, required: true },
]

// Deal section (Step 2). `d` is the whole form. Conditional rules per spec §4.1.
const isBridge = (d: ApplicationData) => d.loan_type === 'Fix & Flip/Renovation' || d.loan_type === 'New Construction'
const isDSCR = (d: ApplicationData) => d.loan_type === 'DSCR Rental Loan'
const isRefi = (d: ApplicationData) => d.purchase_or_refi === 'Refinance' || d.purchase_or_refi === 'Cash-Out Refinance'
const isPurchase = (d: ApplicationData) => d.purchase_or_refi === 'Purchase'

export const DEAL_FIELDS: FieldDef[] = [
  { name: 'has_deal', label: 'Do you have a deal?', type: 'yesno', required: true },
  { name: 'purchase_or_refi', label: 'Purchase or Refi', type: 'select', options: PURCHASE_REFI_OPTIONS, required: true },
  { name: 'loan_type', label: 'Loan Type', type: 'select', options: LOAN_TYPE_OPTIONS, required: true },
  { name: 'property_type', label: 'Property Type', type: 'select', options: PROPERTY_TYPE_OPTIONS, required: true },
  { name: 'property_street', label: 'Property Address Line 1', type: 'text', required: true },
  { name: 'property_city', label: 'City', type: 'text', required: true },
  { name: 'property_state', label: 'State', type: 'text', required: true },
  { name: 'property_zip', label: 'Zip Code', type: 'text', required: true },
  { name: 'deal_source', label: 'Deal Source', type: 'select', options: DEAL_SOURCE_OPTIONS },
  { name: 'date_purchased', label: 'Date Purchased', type: 'date', visibleWhen: isPurchase },
  { name: 'original_purchase_price', label: 'Original Purchase Price', type: 'currency' },
  { name: 'renovations_completed', label: 'Renovations Completed', type: 'currency' },
  { name: 'current_value', label: 'Current Value', type: 'currency', required: true },
  { name: 'current_debt', label: 'Is There Current Debt on the Property?', type: 'yesno', visibleWhen: isRefi },
  { name: 'debt_current_24mo', label: 'Has Debt Been Current Past 24 Months?', type: 'yesno', visibleWhen: (d) => isRefi(d) && d.current_debt === true },
  { name: 'current_loan_balance', label: 'Current Loan Balance', type: 'currency', visibleWhen: isRefi },
  { name: 'purchase_price', label: 'Purchase Price', type: 'currency', required: true, visibleWhen: isPurchase },
  { name: 'construction_costs', label: 'Construction Costs', type: 'currency', visibleWhen: isBridge, requiredWhen: isBridge },
  { name: 'after_repaired_value', label: 'After Repaired Value', type: 'currency', visibleWhen: isBridge, requiredWhen: isBridge },
  { name: 'exit_strategy', label: 'Exit Strategy', type: 'select', options: EXIT_STRATEGY_OPTIONS, visibleWhen: isBridge },
  { name: 'exit_strategy_other', label: 'Exit Strategy — Explain', type: 'textarea', visibleWhen: (d) => isBridge(d) && d.exit_strategy === 'Other (Explain Below)' },
  { name: 'requested_loan_amount', label: 'Requested Loan Amount', type: 'currency' },
  { name: 'cash_for_down_payment', label: 'Cash For Down Payment', type: 'currency', help: 'How much cash do the borrowers have available for a downpayment?' },
  { name: 'reserves_post_closing', label: 'Reserves Post Closing', type: 'currency', help: 'How much cash will borrowers have post closing? Include checking, savings, 401k, IRA etc.' },
  { name: 'number_of_units', label: 'Number of Units', type: 'number', visibleWhen: (d) => isDSCR(d) || d.property_type === 'Multifamily (2-4 Units)' || d.property_type === 'Multifamily (5+ Units)' },
  // Units 1-4 are a repeating sub-section driven by number_of_units (see Task 12).
  { name: 'total_monthly_rents', label: 'Total Monthly Rents (All Units)', type: 'currency', visibleWhen: isDSCR },
  { name: 'rent_roll', label: 'Property Rent Roll/P&L', type: 'file', visibleWhen: isDSCR },
  { name: 'annual_property_taxes', label: 'Annual Property Taxes', type: 'currency' },
  { name: 'annual_property_insurance', label: 'Annual Property Insurance', type: 'currency' },
  { name: 'monthly_flood_insurance', label: 'Monthly Flood Insurance', type: 'currency' },
  { name: 'monthly_hoa_dues', label: 'Monthly HOA Dues', type: 'currency' },
  { name: 'has_broker', label: 'Do you have an outside mortgage broker?', type: 'yesno' },
  { name: 'broker_name', label: "Broker's Name", type: 'text', visibleWhen: (d) => d.has_broker === true },
  { name: 'broker_email', label: "Broker's Email", type: 'email', visibleWhen: (d) => d.has_broker === true },
  { name: 'broker_phone', label: "Broker's Phone", type: 'tel', visibleWhen: (d) => d.has_broker === true },
  { name: 'broker_fee', label: 'Broker Fee', type: 'text', visibleWhen: (d) => d.has_broker === true },
  { name: 'has_title_vendor', label: 'Do you have a preferred vendor for title insurance?', type: 'yesno' },
  { name: 'title_company', label: 'Title Company Name', type: 'text', visibleWhen: (d) => d.has_title_vendor === true },
  { name: 'title_contact_name', label: 'Title Contact Name', type: 'text', visibleWhen: (d) => d.has_title_vendor === true },
  { name: 'title_contact_email', label: 'Title Contact Email', type: 'email', visibleWhen: (d) => d.has_title_vendor === true },
  { name: 'title_contact_phone', label: 'Title Contact Phone', type: 'tel', visibleWhen: (d) => d.has_title_vendor === true },
  { name: 'has_insurance_vendor', label: 'Do you have a preferred vendor for property insurance?', type: 'yesno' },
  { name: 'insurance_company', label: 'Insurance Company Name', type: 'text', visibleWhen: (d) => d.has_insurance_vendor === true },
  { name: 'insurance_contact_name', label: 'Insurance Contact Name', type: 'text', visibleWhen: (d) => d.has_insurance_vendor === true },
  { name: 'insurance_contact_email', label: 'Insurance Contact Email', type: 'email', visibleWhen: (d) => d.has_insurance_vendor === true },
  { name: 'insurance_contact_phone', label: 'Insurance Contact Phone', type: 'tel', visibleWhen: (d) => d.has_insurance_vendor === true },
  { name: 'other_details', label: 'Other Details', type: 'textarea' },
]

// Step 1 primary-only fields (in addition to BORROWER_FIELDS for the primary)
export const PRIMARY_EXTRA_FIELDS: FieldDef[] = [
  { name: 'housing_status', label: 'Housing Status', type: 'select', options: HOUSING_STATUS_OPTIONS },
  { name: 'mortgage_on_primary', label: 'Is there a mortgage on your primary?', type: 'yesno' },
  { name: 'entity_name', label: 'Entity Name', type: 'text' },
  { name: 'entity_type', label: 'Entity Type', type: 'select', options: ENTITY_TYPE_OPTIONS },
  { name: 'hear_about_us', label: 'How did you hear about us?', type: 'select', options: HEAR_ABOUT_OPTIONS, required: true },
  { name: 'hear_about_details', label: 'Details', type: 'text' },
]

export interface UnitData { currently_rented?: boolean; current_rent?: number; market_rent?: number; lease_type?: string }
export const UNIT_FIELDS: FieldDef[] = [
  { name: 'currently_rented', label: 'Currently Rented', type: 'yesno' },
  { name: 'current_rent', label: 'Current Rent', type: 'currency' },
  { name: 'market_rent', label: 'Market Rent', type: 'currency' },
  { name: 'lease_type', label: 'Lease Type', type: 'select', options: LEASE_TYPE_OPTIONS },
]

/** Generic visibility resolver used by the renderer AND server validation. */
export function isVisible(f: FieldDef, data: ApplicationData, scope?: ApplicationData): boolean {
  return f.visibleWhen ? f.visibleWhen(data, scope) : true
}
export function isRequired(f: FieldDef, data: ApplicationData, scope?: ApplicationData): boolean {
  if (!isVisible(f, data, scope)) return false
  if (f.requiredWhen && f.requiredWhen(data, scope)) return true
  return !!f.required
}

export const TOTAL_STEPS = 6
export const STEP_TITLES = ['Borrower Info','Deal Info','Experience','Declarations','Authorization','Payment'] as const
export const MAX_CO_BORROWERS = 3 // 4 borrowers total
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/application-fields.ts
git commit -m "feat(apply): centralized field config + conditional-logic engine"
```

---

## Task 4: Email functions (resume + submitted + LO notification)

**Files:**
- Modify: `src/lib/email.ts` (append three functions; reuse existing transporter + branded template)

- [ ] **Step 1: Append email functions**

Add to the end of `src/lib/email.ts` (uses existing `getTransporter`, `PORTAL_URL`, `PORTAL_DOMAIN`):

```ts
const wrap = (title: string, bodyHtml: string) => `
  <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #333;">
    <div style="background-color: #1F5D8F; padding: 20px 28px; border-radius: 8px 8px 0 0;">
      <h1 style="margin: 0; color: white; font-size: 18px;">${title}</h1>
    </div>
    <div style="background-color: #ffffff; padding: 28px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
      ${bodyHtml}
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin-top: 20px;" />
      <p style="font-size: 11px; color: #9ca3af; margin-bottom: 0;">First Equity Funding Online Portal &nbsp;·&nbsp; ${PORTAL_DOMAIN}</p>
    </div>
  </div>`

export async function sendApplicationResumeEmail(email: string, token: string, firstName: string | null) {
  const link = `${PORTAL_URL}/apply/resume/${token}`
  const html = wrap('Your loan application — saved', `
    <p style="font-size: 15px; margin-top: 0;">Hi ${firstName ?? 'there'},</p>
    <p style="font-size: 15px;">Your loan application has been saved. You can return any time using the secure link below — your answers will be exactly where you left off.</p>
    <p style="margin-top: 24px;">
      <a href="${link}" style="background-color: #1F5D8F; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: bold;">Resume application</a>
    </p>
    <p style="font-size: 13px; color: #555; margin-top: 24px;">Keep this email — the link is private to you.</p>`)
  await getTransporter().sendMail({
    from: `First Equity Funding <${process.env.GMAIL_USER}>`,
    to: email, subject: 'Resume your First Equity loan application', html,
  }).catch(err => console.error(`Resume email to ${email} failed:`, err))
}

export async function sendApplicationSubmittedEmail(email: string, firstName: string | null, propertyAddress: string) {
  const html = wrap('Application received', `
    <p style="font-size: 15px; margin-top: 0;">Hi ${firstName ?? 'there'},</p>
    <p style="font-size: 15px;">We've received your loan application for <strong>${propertyAddress}</strong>. Our team will review it and reach out with next steps. Thank you for choosing First Equity Funding.</p>`)
  await getTransporter().sendMail({
    from: `First Equity Funding <${process.env.GMAIL_USER}>`,
    to: email, subject: 'We received your First Equity loan application', html,
  }).catch(err => console.error(`Submitted email to ${email} failed:`, err))
}

export async function sendApplicationLoanOfficerNotice(loEmail: string, applicantName: string, propertyAddress: string, loanId: string) {
  const html = wrap('New loan application', `
    <p style="font-size: 15px; margin-top: 0;">A new application was submitted.</p>
    <p style="font-size: 15px;"><strong>Applicant:</strong> ${applicantName}<br/><strong>Property:</strong> ${propertyAddress}</p>
    <p style="margin-top: 24px;">
      <a href="${PORTAL_URL}/admin/loans/${loanId}" style="background-color: #1F5D8F; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: bold;">Open in portal</a>
    </p>`)
  await getTransporter().sendMail({
    from: `First Equity Funding <${process.env.GMAIL_USER}>`,
    to: loEmail, subject: `New loan application — ${propertyAddress}`, html,
  }).catch(err => console.error(`LO notice to ${loEmail} failed:`, err))
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/email.ts
git commit -m "feat(apply): resume / submitted / LO-notice emails"
```

---

## Task 5: Draft API routes (create + autosave)

**Files:**
- Create: `src/app/api/apply/draft/route.ts`
- Create: `src/lib/rate-limit.ts`

Auth model: **no login** — possession of `resume_token` authorizes a draft. Service-role client only. Never `console.log` the `data` payload.

- [ ] **Step 1: Write a tiny in-memory rate limiter**

Create `src/lib/rate-limit.ts`:

```ts
// Best-effort in-memory limiter (per warm serverless instance). Good enough
// to blunt abuse on public endpoints; not a security boundary on its own.
const hits = new Map<string, { count: number; reset: number }>()

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const rec = hits.get(key)
  if (!rec || now > rec.reset) {
    hits.set(key, { count: 1, reset: now + windowMs })
    return true
  }
  if (rec.count >= max) return false
  rec.count++
  return true
}

export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  return xff ? xff.split(',')[0].trim() : 'unknown'
}
```

- [ ] **Step 2: Write the draft route**

Create `src/app/api/apply/draft/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendApplicationResumeEmail } from '@/lib/email'
import { rateLimit, clientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

// POST: create a new draft, email the resume link.
export async function POST(req: NextRequest) {
  if (!rateLimit(`draft-create:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  let body: { email?: string; firstName?: string; data?: Record<string, unknown> }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const email = (body.email ?? '').trim().toLowerCase()
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email is required to save your progress.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: row, error } = await admin
    .from('loan_applications')
    .insert({ status: 'draft', current_step: 1, resume_email: email, data: body.data ?? {} })
    .select('id, resume_token')
    .single()
  if (error || !row) return NextResponse.json({ error: 'Could not start application' }, { status: 500 })

  await sendApplicationResumeEmail(email, row.resume_token, body.firstName ?? null)
  return NextResponse.json({ success: true, id: row.id, resumeToken: row.resume_token })
}

// PATCH: autosave an existing draft (authorized by resume_token).
export async function PATCH(req: NextRequest) {
  if (!rateLimit(`draft-save:${clientIp(req)}`, 120, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  let body: { resumeToken?: string; data?: Record<string, unknown>; currentStep?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  if (!body.resumeToken) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from('loan_applications')
    .select('id, status')
    .eq('resume_token', body.resumeToken)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  if (existing.status === 'submitted') return NextResponse.json({ error: 'Already submitted' }, { status: 409 })

  const patch: Record<string, unknown> = {}
  if (body.data !== undefined) patch.data = body.data
  if (typeof body.currentStep === 'number') patch.current_step = Math.max(1, Math.min(6, body.currentStep))
  const { error } = await admin.from('loan_applications').update(patch).eq('id', existing.id)
  if (error) return NextResponse.json({ error: 'Save failed' }, { status: 500 })
  return NextResponse.json({ success: true })
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Manual smoke (optional but recommended)**

With `npm run dev` running:
```bash
curl -s -X POST localhost:3000/api/apply/draft -H 'Content-Type: application/json' -d '{"email":"test@example.com","data":{}}'
```
Expected: `{"success":true,"id":"...","resumeToken":"..."}`. (Email may fail silently if SMTP not set locally — that's fine.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/rate-limit.ts src/app/api/apply/draft/route.ts
git commit -m "feat(apply): draft create + autosave API (token-authorized, rate-limited)"
```

---

## Task 6: Application mapper (form data → portal rows)

**Files:**
- Create: `src/lib/application-mapper.ts`

Pure function (no DB). Structural twin of `jotform-mapper.ts` but Supabase-only. Output column names must match `loan_details` exactly (see `supabase/schema.sql:333-394`).

- [ ] **Step 1: Write the mapper**

Create `src/lib/application-mapper.ts`:

```ts
import { APPLICATION_LOAN_TYPE_MAP, type LoanType } from './types'
import type { ApplicationData } from './application-fields'

export interface MappedBorrower {
  full_name: string
  email: string | null
  phone: string | null
  entity_name: string | null
  current_address_street: string | null
  current_address_city: string | null
  current_address_state: string | null
  current_address_zip: string | null
  at_current_address_2y: boolean | null
  prior_address_street: string | null
  prior_address_city: string | null
  prior_address_state: string | null
  prior_address_zip: string | null
}

export interface MappedApplication {
  borrowers: MappedBorrower[]            // [0] = primary
  loan: {
    property_address: string | null
    loan_type: LoanType | null
    loan_amount: number | null
    entity_name: string | null
    pipeline_stage: 'New Application'
  }
  loanDetails: Record<string, unknown>   // keyed to loan_details columns
  loanDemographics: { ethnicity: string | null; race: string | null; sex: string | null }
  meta: { loanOfficerName: string | null; primaryEmail: string | null; primaryFirstName: string | null; propertyAddress: string }
}

const s = (v: unknown): string | null => {
  if (typeof v === 'string') { const t = v.trim(); return t || null }
  if (typeof v === 'number') return String(v)
  return null
}
const n = (v: unknown): number | null => {
  if (typeof v === 'number') return v
  if (typeof v === 'string') { const c = v.replace(/[$,\s]/g, ''); const x = Number(c); return c && !isNaN(x) ? x : null }
  return null
}
const b = (v: unknown): boolean | null => (v === true ? true : v === false ? false : null)

function borrowerFrom(o: Record<string, unknown>): MappedBorrower {
  const name = [s(o.first_name), s(o.middle_name), s(o.last_name)].filter(Boolean).join(' ')
  return {
    full_name: name || 'Unknown Applicant',
    email: s(o.email),
    phone: s(o.cell_phone) ?? s(o.other_phone),
    entity_name: null,
    current_address_street: s(o.address_street),
    current_address_city: s(o.address_city),
    current_address_state: s(o.address_state),
    current_address_zip: s(o.address_zip),
    at_current_address_2y: b(o.lived_2y),
    prior_address_street: s(o.prior_address_street),
    prior_address_city: s(o.prior_address_city),
    prior_address_state: s(o.prior_address_state),
    prior_address_zip: s(o.prior_address_zip),
  }
}

export function mapApplication(data: ApplicationData): MappedApplication {
  const primary = (data.primary as Record<string, unknown>) ?? {}
  const cobs = Array.isArray(data.co_borrowers) ? (data.co_borrowers as Record<string, unknown>[]) : []
  const borrowers = [borrowerFrom(primary), ...cobs.map(borrowerFrom)]

  const propStreet = s(data.property_street)
  const propAddress = [propStreet, s(data.property_city), s(data.property_state), s(data.property_zip)].filter(Boolean).join(', ')
  const loanTypeLabel = s(data.loan_type)
  const loanType = loanTypeLabel ? (APPLICATION_LOAN_TYPE_MAP[loanTypeLabel] ?? null) : null
  const entityName = s(primary.entity_name)

  const decl = {
    outstanding_judgements: b(primary.d_liens),
    bankruptcy_or_foreclosure: b(primary.d_bankruptcy),
    delinquent_debt: b(primary.d_delinquent),
    foreclosure_obligation: b(primary.d_foreclosure_obligation),
    party_to_lawsuit: b(primary.d_lawsuit),
    down_payment_borrowed: b(primary.d_down_payment_borrowed),
    us_citizen: b(primary.d_us_citizen),
    permanent_resident: b(primary.d_permanent_resident),
    foreign_national: b(primary.d_foreign_national),
    intent_to_occupy: b(primary.d_intent_to_occupy),
    explanation: s(data.declarations_explanation),
    per_borrower: borrowers.map((_, i) => {
      const src = i === 0 ? primary : cobs[i - 1]
      return {
        d_liens: b(src.d_liens), d_bankruptcy: b(src.d_bankruptcy), d_delinquent: b(src.d_delinquent),
        d_foreclosure_obligation: b(src.d_foreclosure_obligation), d_lawsuit: b(src.d_lawsuit),
        d_down_payment_borrowed: b(src.d_down_payment_borrowed), d_us_citizen: b(src.d_us_citizen),
        d_permanent_resident: b(src.d_permanent_resident), d_foreign_national: b(src.d_foreign_national),
        d_intent_to_occupy: b(src.d_intent_to_occupy),
        hmda_ethnicity: s(src.hmda_ethnicity), hmda_race: s(src.hmda_race), hmda_sex: s(src.hmda_sex),
      }
    }),
  }

  const loanDetails: Record<string, unknown> = {
    submitted_at: new Date().toISOString().slice(0, 10),
    property_street: propStreet,
    property_city: s(data.property_city),
    property_state: s(data.property_state),
    property_zip: s(data.property_zip),
    property_type: s(data.property_type),
    number_of_units: n(data.number_of_units),
    loan_type_one: s(data.purchase_or_refi),
    initial_loan_amount: n(data.requested_loan_amount),
    coborrower_name: cobs.length ? borrowers.slice(1).map(x => x.full_name).join('; ') : null,
    experience_borrower: s(primary.flips_last_3y),
    number_of_properties: n(primary.rental_units_owned),
    experience_notes: [
      s(primary.other_re_experience) && `Other RE experience: ${s(primary.other_re_experience)}`,
      s(primary.experience_explanation),
    ].filter(Boolean).join('\n') || null,
    foreign_national: b(primary.d_foreign_national),
    credit_score_estimate: null,
    own_or_rent: s(primary.housing_status),
    mortgage_on_primary: b(primary.mortgage_on_primary),
    title_company: s(data.title_company),
    title_email: s(data.title_contact_email),
    title_phone: s(data.title_contact_phone),
    insurance_company: s(data.insurance_company),
    insurance_email: s(data.insurance_contact_email),
    insurance_phone: s(data.insurance_contact_phone),
    entity_type: s(primary.entity_type),
    down_payment_borrowed: b(primary.d_down_payment_borrowed),
    intent_to_occupy: b(primary.d_intent_to_occupy),
    declarations: decl,
    purchase_price: n(data.purchase_price) ?? n(data.original_purchase_price),
    acquisition_date: s(data.date_purchased),
    value_as_is: n(data.current_value),
    payoff: n(data.current_loan_balance),
    qualifying_rent: n(data.total_monthly_rents),
    annual_property_tax: n(data.annual_property_taxes),
    annual_insurance_premium: n(data.annual_property_insurance),
    annual_hoa_dues: n(data.monthly_hoa_dues),
  }

  return {
    borrowers,
    loan: {
      property_address: propAddress || null,
      loan_type: loanType,
      loan_amount: n(data.requested_loan_amount),
      entity_name: entityName,
      pipeline_stage: 'New Application',
    },
    loanDetails,
    loanDemographics: {
      ethnicity: s(primary.hmda_ethnicity),
      race: s(primary.hmda_race),
      sex: s(primary.hmda_sex),
    },
    meta: {
      loanOfficerName: null, // FE has no LO dropdown source yet; left null (staff assigns in portal)
      primaryEmail: s(primary.email),
      primaryFirstName: s(primary.first_name),
      propertyAddress: propAddress || 'your property',
    },
  }
}
```

> Note: the loan-officer dropdown is intentionally out of v1 data flow — `meta.loanOfficerName` is `null`; staff assign the LO in the portal after submit (the existing admin assign UI already does this). If a public LO picklist is wanted later, source it from the `loan_officers` table and resolve by name here (mirror `jotform` webhook's `ilike` match).

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/application-mapper.ts
git commit -m "feat(apply): pure form-data → portal-rows mapper"
```

---

## Task 7: Submit API route

**Files:**
- Create: `src/app/api/apply/submit/route.ts`

Depends on Tasks 1, 4, 5, 6. Re-validates server-side, runs the mapper, inserts rows, marks the draft submitted, audits, emails.

- [ ] **Step 1: Write the submit route**

Create `src/app/api/apply/submit/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { mapApplication } from '@/lib/application-mapper'
import {
  BORROWER_FIELDS, PRIMARY_EXTRA_FIELDS, DEAL_FIELDS, DECLARATION_FIELDS, HMDA_FIELDS,
  isRequired, type ApplicationData,
} from '@/lib/application-fields'
import { sendApplicationSubmittedEmail, sendApplicationLoanOfficerNotice } from '@/lib/email'
import { rateLimit, clientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

function missingRequired(data: ApplicationData): string[] {
  const miss: string[] = []
  const primary = (data.primary as Record<string, unknown>) ?? {}
  for (const f of [...BORROWER_FIELDS, ...PRIMARY_EXTRA_FIELDS, ...DECLARATION_FIELDS, ...HMDA_FIELDS]) {
    if (isRequired(f, data, primary) && (primary[f.name] === undefined || primary[f.name] === '' || primary[f.name] === null)) miss.push(`primary.${f.name}`)
  }
  for (const f of DEAL_FIELDS) {
    if (isRequired(f, data) && (data[f.name] === undefined || data[f.name] === '' || data[f.name] === null)) miss.push(f.name)
  }
  return miss
}

export async function POST(req: NextRequest) {
  if (!rateLimit(`submit:${clientIp(req)}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  let body: { resumeToken?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  if (!body.resumeToken) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const admin = createAdminClient()
  const { data: app } = await admin
    .from('loan_applications')
    .select('id, status, data, submitted_loan_id')
    .eq('resume_token', body.resumeToken)
    .maybeSingle()
  if (!app) return NextResponse.json({ error: 'Application not found' }, { status: 404 })
  if (app.status === 'submitted') {
    return NextResponse.json({ success: true, alreadySubmitted: true, loanId: app.submitted_loan_id })
  }

  const data = (app.data ?? {}) as ApplicationData
  const miss = missingRequired(data)
  if (miss.length) return NextResponse.json({ error: 'Some required fields are missing', missing: miss }, { status: 422 })

  const m = mapApplication(data)

  // 1. Insert borrowers (email is UNIQUE NOT NULL on borrowers — upsert on email).
  const borrowerIds: (string | null)[] = []
  for (const bw of m.borrowers) {
    if (!bw.email) { borrowerIds.push(null); continue }
    const { data: brow, error: berr } = await admin
      .from('borrowers')
      .upsert({
        email: bw.email.toLowerCase(), full_name: bw.full_name, phone: bw.phone, entity_name: bw.entity_name,
        current_address_street: bw.current_address_street, current_address_city: bw.current_address_city,
        current_address_state: bw.current_address_state, current_address_zip: bw.current_address_zip,
        at_current_address_2y: bw.at_current_address_2y,
        prior_address_street: bw.prior_address_street, prior_address_city: bw.prior_address_city,
        prior_address_state: bw.prior_address_state, prior_address_zip: bw.prior_address_zip,
      }, { onConflict: 'email' })
      .select('id').single()
    if (berr || !brow) return NextResponse.json({ error: 'Failed to save borrower' }, { status: 500 })
    borrowerIds.push(brow.id)
  }

  // 2. Insert loan.
  const { data: loanRow, error: lerr } = await admin
    .from('loans')
    .insert({
      pipedrive_deal_id: null,
      borrower_id: borrowerIds[0] ?? null,
      borrower_id_2: borrowerIds[1] ?? null,
      borrower_id_3: borrowerIds[2] ?? null,
      borrower_id_4: borrowerIds[3] ?? null,
      property_address: m.loan.property_address,
      loan_type: m.loan.loan_type,
      loan_amount: m.loan.loan_amount,
      entity_name: m.loan.entity_name,
      pipeline_stage: 'New Application',
    })
    .select('id').single()
  if (lerr || !loanRow) return NextResponse.json({ error: 'Failed to create loan' }, { status: 500 })
  const loanId = loanRow.id

  // 3. loan_details + loan_demographics.
  await admin.from('loan_details').upsert(
    { loan_id: loanId, ...m.loanDetails, updated_at: new Date().toISOString() },
    { onConflict: 'loan_id' })
  if (m.loanDemographics.ethnicity || m.loanDemographics.race || m.loanDemographics.sex) {
    await admin.from('loan_demographics').upsert(
      { loan_id: loanId, ...m.loanDemographics, source: 'loan_application' },
      { onConflict: 'loan_id' })
  }

  // 4. Mark draft submitted + link loan.
  await admin.from('loan_applications')
    .update({ status: 'submitted', submitted_loan_id: loanId })
    .eq('id', app.id)

  // 5. Audit.
  await admin.from('loan_events').insert({
    loan_id: loanId, event_type: 'application_received',
    description: `Loan application submitted via portal (application ${app.id})`,
  })

  // 6. Emails (best-effort).
  if (m.meta.primaryEmail) await sendApplicationSubmittedEmail(m.meta.primaryEmail, m.meta.primaryFirstName, m.meta.propertyAddress)
  const { data: anyLo } = await admin.from('loan_officers').select('email').not('email', 'is', null).limit(1).maybeSingle()
  if (anyLo?.email) await sendApplicationLoanOfficerNotice(anyLo.email, m.borrowers[0]?.full_name ?? 'Applicant', m.meta.propertyAddress, loanId)

  return NextResponse.json({ success: true, loanId })
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/apply/submit/route.ts
git commit -m "feat(apply): submit pipeline — validate, map, create portal rows, audit, email"
```

---

## Task 8: Payment API route (Square customer + card-on-file)

**Files:**
- Create: `src/app/api/apply/payment/route.ts`

Depends on Tasks 1, 2, 5. Exchanges a Web-SDK card token for a saved card. No charge.

- [ ] **Step 1: Write the payment route**

Create `src/app/api/apply/payment/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { squareClient, feeCentsForBorrowerCount } from '@/lib/square'
import { rateLimit, clientIp } from '@/lib/rate-limit'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  if (!rateLimit(`pay:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  let body: { resumeToken?: string; cardToken?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  if (!body.resumeToken || !body.cardToken) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const admin = createAdminClient()
  const { data: app } = await admin
    .from('loan_applications')
    .select('id, status, data, resume_email')
    .eq('resume_token', body.resumeToken)
    .maybeSingle()
  if (!app) return NextResponse.json({ error: 'Application not found' }, { status: 404 })
  if (app.status === 'submitted') return NextResponse.json({ error: 'Already submitted' }, { status: 409 })

  const data = (app.data ?? {}) as Record<string, unknown>
  const cobs = Array.isArray(data.co_borrowers) ? (data.co_borrowers as unknown[]) : []
  const borrowerCount = 1 + cobs.length
  const feeCents = feeCentsForBorrowerCount(borrowerCount)

  try {
    const sq = squareClient()
    const cust = await sq.customers.create({
      idempotencyKey: randomUUID(),
      emailAddress: app.resume_email ?? undefined,
      note: `Loan application ${app.id}`,
    })
    const customerId = cust.customer?.id
    if (!customerId) throw new Error('No customer id')

    const card = await sq.cards.create({
      idempotencyKey: randomUUID(),
      sourceId: body.cardToken,
      card: { customerId },
    })
    const c = card.card
    if (!c?.id) throw new Error('No card id')

    await admin.from('loan_applications').update({
      square_customer_id: customerId,
      square_card_id: c.id,
      card_brand: c.cardBrand ?? null,
      card_last4: c.last4 ?? null,
      fee_amount_cents: feeCents,
    }).eq('id', app.id)

    return NextResponse.json({ success: true, feeCents, last4: c.last4 ?? null, brand: c.cardBrand ?? null })
  } catch (e) {
    console.error('Square card-on-file failed:', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: 'Could not save card. Please re-check your card details.' }, { status: 502 })
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS. (If the Square SDK method names differ in the installed version, fix to match `node_modules/square` types — keep behavior identical.)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/apply/payment/route.ts
git commit -m "feat(apply): Square card-on-file endpoint (no charge at submit)"
```

---

## Task 9: Wizard shell + generic FieldRenderer + autosave hook

**Files:**
- Create: `src/app/apply/_components/field-renderer.tsx`
- Create: `src/app/apply/_components/use-autosave.ts`
- Create: `src/app/apply/_components/wizard.tsx`

- [ ] **Step 1: FieldRenderer**

Create `src/app/apply/_components/field-renderer.tsx`:

```tsx
'use client'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { isVisible, type FieldDef, type ApplicationData } from '@/lib/application-fields'

type Props = {
  fields: FieldDef[]
  data: ApplicationData          // whole-form data (for visibleWhen on deal fields)
  scope: Record<string, unknown> // the object being edited (primary, a co-borrower, the form root)
  onChange: (name: string, value: unknown) => void
}

export function FieldRenderer({ fields, data, scope, onChange }: Props) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.filter(f => isVisible(f, data, scope)).map(f => {
        const v = scope[f.name]
        const id = `f-${f.name}`
        const wide = f.type === 'textarea' || f.type === 'radio'
        return (
          <div key={f.name} className={`space-y-1.5 ${wide ? 'sm:col-span-2' : ''}`}>
            <Label htmlFor={id}>{f.label}{f.required ? ' *' : ''}</Label>
            {f.type === 'textarea' ? (
              <textarea id={id} className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                value={(v as string) ?? ''} onChange={e => onChange(f.name, e.target.value)} />
            ) : f.type === 'select' ? (
              <select id={id} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={(v as string) ?? ''} onChange={e => onChange(f.name, e.target.value)}>
                <option value="">— Select —</option>
                {f.options!.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === 'yesno' ? (
              <div className="flex gap-4 pt-1">
                {['Yes','No'].map(lbl => (
                  <label key={lbl} className="flex items-center gap-1.5 text-sm">
                    <input type="radio" name={id} checked={v === (lbl === 'Yes')}
                      onChange={() => onChange(f.name, lbl === 'Yes')} /> {lbl}
                  </label>
                ))}
              </div>
            ) : f.type === 'radio' ? (
              <div className="flex flex-col gap-1.5 pt-1">
                {f.options!.map(o => (
                  <label key={o} className="flex items-center gap-1.5 text-sm">
                    <input type="radio" name={id} checked={v === o}
                      onChange={() => onChange(f.name, o)} /> {o}
                  </label>
                ))}
              </div>
            ) : (
              <Input id={id}
                type={f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : f.type === 'date' ? 'date' : f.type === 'number' || f.type === 'currency' ? 'text' : 'text'}
                inputMode={f.type === 'number' || f.type === 'currency' ? 'decimal' : undefined}
                placeholder={f.placeholder ?? (f.type === 'ssn' ? '###-##-####' : f.type === 'currency' ? '$' : undefined)}
                value={(v as string) ?? ''} onChange={e => onChange(f.name, e.target.value)} />
            )}
            {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Autosave hook**

Create `src/app/apply/_components/use-autosave.ts`:

```ts
'use client'
import { useEffect, useRef } from 'react'

/** Debounced PATCH to /api/apply/draft. No-op until a resumeToken exists. */
export function useAutosave(resumeToken: string | null, data: unknown, currentStep: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!resumeToken) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      fetch('/api/apply/draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeToken, data, currentStep }),
      }).catch(() => {})
    }, 1500)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [resumeToken, data, currentStep])
}
```

- [ ] **Step 3: Wizard shell** (progress bar, step nav, draft bootstrap)

Create `src/app/apply/_components/wizard.tsx`:

```tsx
'use client'
import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { STEP_TITLES, TOTAL_STEPS, type ApplicationData } from '@/lib/application-fields'
import { Step1Borrower } from '../_steps/step1-borrower'
import { Step2Deal } from '../_steps/step2-deal'
import { Step3Experience } from '../_steps/step3-experience'
import { Step4Declarations } from '../_steps/step4-declarations'
import { Step5Authorization } from '../_steps/step5-authorization'
import { Step6Payment } from '../_steps/step6-payment'
import { useAutosave } from './use-autosave'

export function Wizard({ initialData, initialStep, initialToken }: {
  initialData: ApplicationData; initialStep: number; initialToken: string | null
}) {
  const [data, setData] = useState<ApplicationData>(initialData ?? {})
  const [step, setStep] = useState(initialStep || 1)
  const [token, setToken] = useState<string | null>(initialToken)
  const [submitting, setSubmitting] = useState(false)

  useAutosave(token, data, step)

  const set = useCallback((patch: Record<string, unknown>) => setData(d => ({ ...d, ...patch })), [])

  // Create the draft once we have the primary email (called by Step 1 on email blur).
  const ensureDraft = useCallback(async (email: string, firstName: string) => {
    if (token || !email) return
    const res = await fetch('/api/apply/draft', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, firstName, data }),
    })
    const j = await res.json()
    if (j.success) { setToken(j.resumeToken); toast.success('Progress saved — a resume link was emailed to you.') }
    else toast.error(j.error ?? 'Could not start application')
  }, [token, data])

  async function submit() {
    setSubmitting(true)
    const res = await fetch('/api/apply/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resumeToken: token }),
    })
    const j = await res.json()
    setSubmitting(false)
    if (j.success) window.location.href = '/apply/submitted'
    else if (j.missing) toast.error(`Missing required fields: ${j.missing.slice(0, 5).join(', ')}${j.missing.length > 5 ? '…' : ''}`)
    else toast.error(j.error ?? 'Submit failed')
  }

  const stepEl = [
    <Step1Borrower key={1} data={data} set={set} ensureDraft={ensureDraft} />,
    <Step2Deal key={2} data={data} set={set} />,
    <Step3Experience key={3} data={data} set={set} />,
    <Step4Declarations key={4} data={data} set={set} />,
    <Step5Authorization key={5} data={data} set={set} />,
    <Step6Payment key={6} data={data} set={set} token={token} />,
  ][step - 1]

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-8">
      <div className="mb-6">
        <div className="flex flex-wrap gap-2 text-xs">
          {STEP_TITLES.map((t, i) => (
            <span key={t} className={`rounded px-2 py-1 ${i + 1 === step ? 'bg-[#1F5D8F] text-white' : i + 1 < step ? 'bg-slate-200' : 'bg-slate-100 text-slate-400'}`}>{i + 1}. {t}</span>
          ))}
        </div>
        <div className="mt-3 h-1.5 rounded bg-slate-200">
          <div className="h-1.5 rounded bg-[#1F5D8F] transition-all" style={{ width: `${(step / TOTAL_STEPS) * 100}%` }} />
        </div>
      </div>

      <h2 className="mb-4 text-xl font-semibold text-[#1F5D8F]">{STEP_TITLES[step - 1]}</h2>
      {stepEl}

      <div className="mt-8 flex justify-between">
        <Button variant="outline" disabled={step === 1} onClick={() => setStep(s => Math.max(1, s - 1))}>← Back</Button>
        {step < TOTAL_STEPS
          ? <Button onClick={() => setStep(s => Math.min(TOTAL_STEPS, s + 1))}>Next →</Button>
          : <Button onClick={submit} disabled={submitting || !token}>{submitting ? 'Submitting…' : 'Submit Application'}</Button>}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: FAIL — step components don't exist yet (`Cannot find module '../_steps/step1-borrower'`). This is expected; Tasks 10/12/13 create them. **Do not commit a broken build.** Proceed to Task 10–13, then build+commit at the end of Task 13.

> Execution note: Tasks 9, 10, 12, 13 form one buildable unit. Implement 9 → 10 → 12 → 13, then run `npm run build` once green and commit all four together (commit shown at end of Task 13).

---

## Task 10: Step 1 (Borrower) + Step 3 (Experience) + repeating co-borrowers

**Files:**
- Create: `src/app/apply/_steps/step1-borrower.tsx`
- Create: `src/app/apply/_steps/step3-experience.tsx`
- Create: `src/app/apply/_components/repeating-borrowers.tsx`

- [ ] **Step 1: Repeating co-borrower helper**

Create `src/app/apply/_components/repeating-borrowers.tsx`:

```tsx
'use client'
import { Button } from '@/components/ui/button'
import { MAX_CO_BORROWERS, type FieldDef, type ApplicationData } from '@/lib/application-fields'
import { FieldRenderer } from './field-renderer'

export function RepeatingBorrowers({ data, fields, set, heading }: {
  data: ApplicationData; fields: FieldDef[]; heading: string
  set: (patch: Record<string, unknown>) => void
}) {
  const cobs = Array.isArray(data.co_borrowers) ? (data.co_borrowers as Record<string, unknown>[]) : []
  const update = (i: number, name: string, value: unknown) => {
    const next = cobs.map((c, idx) => idx === i ? { ...c, [name]: value } : c)
    set({ co_borrowers: next })
  }
  return (
    <div className="space-y-6">
      {cobs.map((c, i) => (
        <div key={i} className="rounded-lg border p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-medium">{heading} {i + 1}</h3>
            <Button variant="ghost" size="sm" onClick={() => set({ co_borrowers: cobs.filter((_, idx) => idx !== i) })}>Remove</Button>
          </div>
          <FieldRenderer fields={fields} data={data} scope={c} onChange={(n, v) => update(i, n, v)} />
        </div>
      ))}
      {cobs.length < MAX_CO_BORROWERS && (
        <Button variant="outline" size="sm" onClick={() => set({ co_borrowers: [...cobs, {}] })}>+ Add Co-Borrower</Button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Step 1**

Create `src/app/apply/_steps/step1-borrower.tsx`:

```tsx
'use client'
import { BORROWER_FIELDS, PRIMARY_EXTRA_FIELDS, type ApplicationData } from '@/lib/application-fields'
import { FieldRenderer } from '../_components/field-renderer'
import { RepeatingBorrowers } from '../_components/repeating-borrowers'

export function Step1Borrower({ data, set, ensureDraft }: {
  data: ApplicationData
  set: (patch: Record<string, unknown>) => void
  ensureDraft: (email: string, firstName: string) => void
}) {
  const primary = (data.primary as Record<string, unknown>) ?? {}
  const setPrimary = (name: string, value: unknown) => {
    set({ primary: { ...primary, [name]: value } })
    if (name === 'email' && typeof value === 'string' && value.includes('@'))
      ensureDraft(value, (primary.first_name as string) ?? '')
  }
  return (
    <div className="space-y-8">
      <FieldRenderer fields={[...BORROWER_FIELDS, ...PRIMARY_EXTRA_FIELDS]} data={data} scope={primary} onChange={setPrimary} />
      <div>
        <h3 className="mb-3 font-medium text-[#1F5D8F]">Co-Borrowers</h3>
        <RepeatingBorrowers data={data} fields={BORROWER_FIELDS} set={set} heading="Co-Borrower" />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Step 3 (Experience, per borrower)**

Create `src/app/apply/_steps/step3-experience.tsx`:

```tsx
'use client'
import { EXPERIENCE_FIELDS, type ApplicationData } from '@/lib/application-fields'
import { FieldRenderer } from '../_components/field-renderer'

export function Step3Experience({ data, set }: {
  data: ApplicationData; set: (patch: Record<string, unknown>) => void
}) {
  const primary = (data.primary as Record<string, unknown>) ?? {}
  const cobs = Array.isArray(data.co_borrowers) ? (data.co_borrowers as Record<string, unknown>[]) : []
  return (
    <div className="space-y-8">
      <div>
        <h3 className="mb-3 font-medium">Primary Borrower</h3>
        <FieldRenderer fields={EXPERIENCE_FIELDS} data={data} scope={primary}
          onChange={(n, v) => set({ primary: { ...primary, [n]: v } })} />
      </div>
      {cobs.map((c, i) => (
        <div key={i}>
          <h3 className="mb-3 font-medium">Co-Borrower {i + 1}</h3>
          <FieldRenderer fields={EXPERIENCE_FIELDS} data={data} scope={c}
            onChange={(n, v) => set({ co_borrowers: cobs.map((x, idx) => idx === i ? { ...x, [n]: v } : x) })} />
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: (build verified at end of Task 13)**

---

## Task 11: Admin "Charge Credit & Background Fee" action

**Files:**
- Create: `src/app/api/admin/loans/[id]/charge-fee/route.ts`
- Create: `src/components/admin-charge-fee.tsx`
- Modify: `src/app/admin/loans/[id]/page.tsx` (render the button in the staff-actions column)

Depends on Tasks 1, 2. Independent of the public form.

- [ ] **Step 1: Charge route (admin-only)**

Create `src/app/api/admin/loans/[id]/charge-fee/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { squareClient, SQUARE_LOCATION_ID } from '@/lib/square'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data: isAdmin } = await admin.from('admin_users').select('id').eq('auth_user_id', user.id).single()
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: app } = await admin
    .from('loan_applications')
    .select('id, square_customer_id, square_card_id, fee_amount_cents, fee_charged_at')
    .eq('submitted_loan_id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'No application linked to this loan' }, { status: 404 })
  if (app.fee_charged_at) return NextResponse.json({ error: 'Fee already charged' }, { status: 409 })
  if (!app.square_customer_id || !app.square_card_id || !app.fee_amount_cents)
    return NextResponse.json({ error: 'No saved card on file' }, { status: 400 })

  try {
    const sq = squareClient()
    const pay = await sq.payments.create({
      idempotencyKey: randomUUID(),
      sourceId: app.square_card_id,
      customerId: app.square_customer_id,
      locationId: SQUARE_LOCATION_ID(),
      amountMoney: { amount: BigInt(app.fee_amount_cents), currency: 'USD' },
      note: `Credit & Background Check — loan ${id}`,
    })
    if (pay.payment?.status !== 'COMPLETED' && pay.payment?.status !== 'APPROVED')
      throw new Error(`Square status ${pay.payment?.status}`)

    await admin.from('loan_applications').update({ fee_charged_at: new Date().toISOString() }).eq('id', app.id)
    await admin.from('loan_events').insert({
      loan_id: id, event_type: 'fee_charged',
      description: `Credit & Background Check fee charged: $${(app.fee_amount_cents / 100).toFixed(2)}`,
    })
    return NextResponse.json({ success: true, amount: app.fee_amount_cents })
  } catch (e) {
    console.error('Square charge failed:', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: 'Charge failed — see Square dashboard' }, { status: 502 })
  }
}
```

- [ ] **Step 2: Button component**

Create `src/components/admin-charge-fee.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function AdminChargeFee({ loanId, feeCents, chargedAt, last4, brand }: {
  loanId: string; feeCents: number | null; chargedAt: string | null; last4: string | null; brand: string | null
}) {
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(!!chargedAt)
  if (feeCents == null) return null
  async function charge() {
    setLoading(true)
    const res = await fetch(`/api/admin/loans/${loanId}/charge-fee`, { method: 'POST' })
    const j = await res.json()
    setLoading(false)
    if (j.success) { setDone(true); toast.success('Fee charged') }
    else toast.error(j.error ?? 'Charge failed')
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Credit &amp; Background Fee</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">Amount: <strong>${(feeCents / 100).toFixed(2)}</strong>{brand && last4 ? ` · ${brand} ••${last4}` : ''}</p>
        {done
          ? <p className="text-sm text-green-600 font-medium">✓ Charged</p>
          : <Button size="sm" onClick={charge} disabled={loading}>{loading ? 'Charging…' : 'Charge saved card'}</Button>}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3: Render it on the admin loan page**

In `src/app/admin/loans/[id]/page.tsx`: after the loan is fetched, also fetch the linked application, and render `<AdminChargeFee>` in the same staff-actions column as `AdminLoanOfficerAssign`. Add the query (use the existing `adminClient` variable in that file):

```ts
const { data: linkedApp } = await adminClient
  .from('loan_applications')
  .select('fee_amount_cents, fee_charged_at, card_last4, card_brand')
  .eq('submitted_loan_id', id).maybeSingle()
```
And in the staff-actions JSX block (next to the assign components), add:
```tsx
{linkedApp && (
  <AdminChargeFee loanId={id} feeCents={linkedApp.fee_amount_cents}
    chargedAt={linkedApp.fee_charged_at} last4={linkedApp.card_last4} brand={linkedApp.card_brand} />
)}
```
Add the import at the top: `import { AdminChargeFee } from '@/components/admin-charge-fee'`.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/loans/[id]/charge-fee/route.ts src/components/admin-charge-fee.tsx src/app/admin/loans/[id]/page.tsx
git commit -m "feat(apply): admin charge-saved-card action for credit & background fee"
```

---

## Task 12: Step 2 (Deal) + repeating rental units

**Files:**
- Create: `src/app/apply/_steps/step2-deal.tsx`
- Create: `src/app/apply/_components/repeating-units.tsx`

- [ ] **Step 1: Repeating units**

Create `src/app/apply/_components/repeating-units.tsx`:

```tsx
'use client'
import { UNIT_FIELDS, type ApplicationData } from '@/lib/application-fields'
import { FieldRenderer } from './field-renderer'

export function RepeatingUnits({ data, set }: {
  data: ApplicationData; set: (patch: Record<string, unknown>) => void
}) {
  const count = Math.max(0, Math.min(4, Number(data.number_of_units) || 0))
  if (!count) return null
  const units = Array.isArray(data.units) ? (data.units as Record<string, unknown>[]) : []
  const rows = Array.from({ length: count }, (_, i) => units[i] ?? {})
  const update = (i: number, name: string, value: unknown) => {
    const next = rows.map((u, idx) => idx === i ? { ...u, [name]: value } : u)
    set({ units: next })
  }
  return (
    <div className="space-y-4">
      {rows.map((u, i) => (
        <div key={i} className="rounded-lg border p-4">
          <h4 className="mb-2 font-medium">Unit {i + 1}</h4>
          <FieldRenderer fields={UNIT_FIELDS} data={data} scope={u} onChange={(n, v) => update(i, n, v)} />
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Step 2**

Create `src/app/apply/_steps/step2-deal.tsx`:

```tsx
'use client'
import { DEAL_FIELDS, type ApplicationData } from '@/lib/application-fields'
import { FieldRenderer } from '../_components/field-renderer'
import { RepeatingUnits } from '../_components/repeating-units'

export function Step2Deal({ data, set }: {
  data: ApplicationData; set: (patch: Record<string, unknown>) => void
}) {
  return (
    <div className="space-y-6">
      <FieldRenderer fields={DEAL_FIELDS} data={data} scope={data} onChange={(n, v) => set({ [n]: v })} />
      <RepeatingUnits data={data} set={set} />
    </div>
  )
}
```

- [ ] **Step 3: (build verified at end of Task 13)**

---

## Task 13: Step 4 (Declarations) + Step 5 (Authorization) + Step 6 (Payment) + final build

**Files:**
- Create: `src/app/apply/_steps/step4-declarations.tsx`
- Create: `src/app/apply/_steps/step5-authorization.tsx`
- Create: `src/app/apply/_steps/step6-payment.tsx`

- [ ] **Step 1: Step 4 (Declarations + HMDA, per borrower)**

Create `src/app/apply/_steps/step4-declarations.tsx`:

```tsx
'use client'
import { DECLARATION_FIELDS, HMDA_FIELDS, type ApplicationData } from '@/lib/application-fields'
import { FieldRenderer } from '../_components/field-renderer'

export function Step4Declarations({ data, set }: {
  data: ApplicationData; set: (patch: Record<string, unknown>) => void
}) {
  const primary = (data.primary as Record<string, unknown>) ?? {}
  const cobs = Array.isArray(data.co_borrowers) ? (data.co_borrowers as Record<string, unknown>[]) : []
  const blocks = [{ label: 'Primary Borrower', scope: primary, save: (n: string, v: unknown) => set({ primary: { ...primary, [n]: v } }) },
    ...cobs.map((c, i) => ({ label: `Co-Borrower ${i + 1}`, scope: c, save: (n: string, v: unknown) => set({ co_borrowers: cobs.map((x, idx) => idx === i ? { ...x, [n]: v } : x) }) }))]
  return (
    <div className="space-y-8">
      {blocks.map((bk, idx) => (
        <div key={idx} className="space-y-4">
          <h3 className="font-medium text-[#1F5D8F]">{bk.label} — Declarations</h3>
          <FieldRenderer fields={DECLARATION_FIELDS} data={data} scope={bk.scope} onChange={bk.save} />
          <h4 className="font-medium">Government Monitoring (HMDA)</h4>
          <FieldRenderer fields={HMDA_FIELDS} data={data} scope={bk.scope} onChange={bk.save} />
        </div>
      ))}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">If you answered yes to any of the above declarations, please explain</label>
        <textarea className="flex min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          value={(data.declarations_explanation as string) ?? ''} onChange={e => set({ declarations_explanation: e.target.value })} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Step 5 (Authorization — typed-name attestation)**

Create `src/app/apply/_steps/step5-authorization.tsx`. Use the certification + authorization text from spec/PDF (pages 8–9). The two attestation blocks each require a typed name + agree checkbox:

```tsx
'use client'
import { type ApplicationData } from '@/lib/application-fields'

const CERT_TEXT = `The Undersigned certifies the following: (1) I/We have applied for a mortgage loan through First Equity Funding, LP. In applying for the loan, I/We completed a loan application containing various information on the purpose of the loan, the amount and source of the down payment, employment and income information, and the assets and liabilities. I/We certify that all of the information is true and complete. I/We made no misrepresentations in the loan application or other documents, nor did I/We omit any pertinent information. (2) I/We understand and agree that First Equity Funding, LP reserves the right to change the mortgage loan review processes to a full documentation program. (3) I/We fully understand that it is a Federal crime punishable by fine or imprisonment, or both, to knowingly make any false statements when applying for this mortgage, as applicable under the provisions of Title 18, United States Code, Section 1014.`
const AUTH_TEXT = `AUTHORIZATION TO RELEASE INFORMATION — I/We have applied for a mortgage loan through First Equity Funding, LP. As part of the application process, First Equity Funding, LP and the mortgage guaranty insurer (if any), may verify information contained in my/our loan application and in other documents required in connection with the loan. I/We authorize First Equity Funding, LP and its affiliates to order a background check and a consumer credit report and to charge my credit card to pay for these services and any appraisal/draw inspection/processing fees. A copy of this authorization may be accepted as an original. I understand this is not a commitment to lend and that these fees are non-refundable.`

function Block({ id, title, text, data, set }: {
  id: string; title: string; text: string
  data: ApplicationData; set: (patch: Record<string, unknown>) => void
}) {
  const primary = (data.primary as Record<string, unknown>) ?? {}
  const printed = [primary.first_name, primary.last_name].filter(Boolean).join(' ')
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h3 className="font-medium text-[#1F5D8F]">{title}</h3>
      <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs text-slate-700">{text}</p>
      <p className="text-sm">Printed name: <strong>{printed || '—'}</strong> · Date: {new Date().toLocaleDateString()}</p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={data[`${id}_agree`] === true}
          onChange={e => set({ [`${id}_agree`]: e.target.checked })} />
        I have read and agree to the above.
      </label>
      <div className="space-y-1.5">
        <label className="text-sm">Type your full legal name as your signature *</label>
        <input className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          value={(data[`${id}_signature`] as string) ?? ''} onChange={e => set({ [`${id}_signature`]: e.target.value })} />
      </div>
    </div>
  )
}

export function Step5Authorization({ data, set }: {
  data: ApplicationData; set: (patch: Record<string, unknown>) => void
}) {
  return (
    <div className="space-y-6">
      <Block id="cert" title="Borrowers' Certification and Authorization" text={CERT_TEXT} data={data} set={set} />
      <Block id="auth" title="Authorization to Release Information & Charge Card" text={AUTH_TEXT} data={data} set={set} />
    </div>
  )
}
```

- [ ] **Step 3: Step 6 (Payment — Square Web Payments SDK)**

Create `src/app/apply/_steps/step6-payment.tsx`. Loads the Square Web SDK script, tokenizes the card, posts to `/api/apply/payment`:

```tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { type ApplicationData } from '@/lib/application-fields'

declare global { interface Window { Square?: any } }

export function Step6Payment({ data, token }: {
  data: ApplicationData; set: (patch: Record<string, unknown>) => void; token: string | null
}) {
  const cardRef = useRef<any>(null)
  const [ready, setReady] = useState(false)
  const [saved, setSaved] = useState<{ last4: string; brand: string; feeCents: number } | null>(null)
  const cobs = Array.isArray(data.co_borrowers) ? (data.co_borrowers as unknown[]) : []
  const feeUsd = (1 + cobs.length) * 45

  useEffect(() => {
    const appId = process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID
    const env = process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT === 'production' ? '' : 'sandbox.'
    if (!appId) return
    const src = `https://${env}web.squarecdn.com/v1/square.js`
    const existing = document.querySelector(`script[src="${src}"]`)
    const init = async () => {
      if (!window.Square) return
      const payments = window.Square.payments(appId, process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID)
      const card = await payments.card()
      await card.attach('#sq-card')
      cardRef.current = card
      setReady(true)
    }
    if (existing) { init(); return }
    const sc = document.createElement('script')
    sc.src = src; sc.onload = init; document.body.appendChild(sc)
  }, [])

  async function saveCard() {
    if (!cardRef.current || !token) return
    const result = await cardRef.current.tokenize()
    if (result.status !== 'OK') { toast.error('Card details invalid'); return }
    const res = await fetch('/api/apply/payment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resumeToken: token, cardToken: result.token }),
    })
    const j = await res.json()
    if (j.success) { setSaved({ last4: j.last4, brand: j.brand, feeCents: j.feeCents }); toast.success('Card saved') }
    else toast.error(j.error ?? 'Could not save card')
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4">
        <p className="text-sm">Credit &amp; Background Check</p>
        <p className="text-2xl font-semibold text-[#1F5D8F]">${feeUsd.toFixed(2)}</p>
        <p className="text-xs text-muted-foreground">$45 × {1 + cobs.length} borrower(s). Your card is saved securely with Square and charged by our team after review — not now.</p>
      </div>
      {saved
        ? <p className="text-sm text-green-600 font-medium">✓ Card saved: {saved.brand} ••{saved.last4}</p>
        : <>
            <div id="sq-card" className="rounded-md border p-3" />
            <Button onClick={saveCard} disabled={!ready || !token}>{ready ? 'Save card on file' : 'Loading payment form…'}</Button>
            {!token && <p className="text-xs text-red-600">Enter your email in Step 1 first so we can attach the card to your application.</p>}
          </>}
    </div>
  )
}
```

> Add `NEXT_PUBLIC_SQUARE_LOCATION_ID` and `NEXT_PUBLIC_SQUARE_ENVIRONMENT` to `.env.local` / Vercel (location id is safe to expose; access token is not).

- [ ] **Step 4: Verify the whole UI unit builds**

Run: `npm run build`
Expected: PASS (Tasks 9, 10, 12, 13 now complete the module graph).

- [ ] **Step 5: Commit the UI unit**

```bash
git add src/app/apply/_components src/app/apply/_steps
git commit -m "feat(apply): 6-step wizard UI — renderer, autosave, steps, repeating sections, Square card"
```

---

## Task 14: Public `/apply` route, layout, resume page, confirmation page

**Files:**
- Create: `src/app/apply/layout.tsx`
- Create: `src/app/apply/page.tsx`
- Create: `src/app/apply/submitted/page.tsx`
- Create: `src/app/apply/resume/[token]/page.tsx`

- [ ] **Step 1: Public layout (no auth, no PortalShell)**

Create `src/app/apply/layout.tsx`:

```tsx
export default function ApplyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white px-6 py-4">
        <span className="text-lg font-semibold text-[#1F5D8F]">First Equity Funding — Loan Application</span>
      </header>
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Apply entry page (fresh wizard)**

Create `src/app/apply/page.tsx`:

```tsx
import { Wizard } from './_components/wizard'

export const metadata = { title: 'Loan Application — First Equity Funding' }

export default function ApplyPage() {
  return <Wizard initialData={{}} initialStep={1} initialToken={null} />
}
```

- [ ] **Step 3: Submitted confirmation**

Create `src/app/apply/submitted/page.tsx`:

```tsx
export const metadata = { title: 'Application Received' }
export default function SubmittedPage() {
  return (
    <div className="mx-auto max-w-xl p-12 text-center">
      <h1 className="mb-3 text-2xl font-semibold text-[#1F5D8F]">Application received</h1>
      <p className="text-slate-600">Thank you. Our team will review your application and reach out with next steps. A confirmation email is on its way.</p>
    </div>
  )
}
```

- [ ] **Step 4: Resume page (server component loads draft by token)**

Create `src/app/apply/resume/[token]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { Wizard } from '../../_components/wizard'

export const metadata = { title: 'Resume Application' }

export default async function ResumePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = createAdminClient()
  const { data: app } = await admin
    .from('loan_applications')
    .select('data, current_step, status, resume_token')
    .eq('resume_token', token)
    .maybeSingle()
  if (!app) notFound()
  if (app.status === 'submitted') {
    return <div className="mx-auto max-w-xl p-12 text-center"><h1 className="text-2xl font-semibold text-[#1F5D8F]">Already submitted</h1><p className="text-slate-600">This application has already been submitted.</p></div>
  }
  return <Wizard initialData={(app.data ?? {}) as Record<string, unknown>} initialStep={app.current_step ?? 1} initialToken={app.resume_token} />
}
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: PASS. Confirm `/apply` is NOT behind auth (no redirect; the route has no `getUser()` gate and there is no `middleware.ts`).

- [ ] **Step 6: Commit**

```bash
git add src/app/apply/layout.tsx src/app/apply/page.tsx src/app/apply/submitted src/app/apply/resume
git commit -m "feat(apply): public /apply route, layout, resume + confirmation pages"
```

---

## Task 15: Pipedrive sync guard (don't touch app-origin loans)

**Files:**
- Modify: `src/app/api/cron/sync/route.ts`

- [ ] **Step 1: Locate the upsert/delete logic**

Open `src/app/api/cron/sync/route.ts`. Find where it writes/deletes `loans` based on the Pipedrive fetch. App-origin loans have `pipedrive_deal_id IS NULL`.

- [ ] **Step 2: Guard mutations**

Ensure any UPDATE/DELETE the sync performs against `loans` is constrained to `pipedrive_deal_id IS NOT NULL` (or filtered to the set of fetched Pipedrive deal IDs). Concretely: if the sync deletes loans not present in Pipedrive, add `.not('pipedrive_deal_id', 'is', null)` to that query so application loans are never deleted; upserts keyed on `pipedrive_deal_id` already won't collide with NULLs. Add a code comment:

```ts
// App-created loans have pipedrive_deal_id = NULL and are NOT managed by
// Pipedrive sync — never update or delete them here.
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/sync/route.ts
git commit -m "fix(sync): never mutate app-origin (pipedrive_deal_id NULL) loans"
```

---

## Task 16: End-to-end verification (Playwright MCP)

**No files.** Uses the Playwright MCP against `npm run dev` (Square in sandbox).

- [ ] **Step 1: Start dev server**

Run (background): `npm run dev`. Confirm `http://localhost:3000/apply` loads with no login redirect.

- [ ] **Step 2: Walk the happy path** (Playwright MCP)

Navigate `/apply`. Fill Step 1 primary borrower incl. a real email → blur email → assert a "Progress saved" toast and that a `loan_applications` row exists (`select count(*) from loan_applications where status='draft'` via Supabase MCP = ≥1). Add one co-borrower. Advance through Steps 2–5 (pick Loan Type = "Fix & Flip/Renovation" → assert Construction Costs/ARV visible, DSCR rent fields hidden; switch to "DSCR Rental Loan" → assert inverse; set Number of Units = 3 → assert 3 Unit blocks). Step 6: enter Square sandbox test card `4111 1111 1111 1111`, any future expiry, CVV `111`, ZIP `94103` → Save card → assert "Card saved" + `square_card_id` populated. Submit → assert redirect to `/apply/submitted`.

- [ ] **Step 3: Verify portal rows**

Via Supabase MCP: confirm one new `loans` row (`pipeline_stage='New Application'`, `pipedrive_deal_id IS NULL`), matching `borrowers` (primary + co-borrower), `loan_details`, `loan_demographics`, a `loan_events` `application_received` row, and `loan_applications.status='submitted'` with `submitted_loan_id` set.

- [ ] **Step 4: Verify resume**

Open a fresh draft (new email), fill partial Step 1–2, copy its `resume_token` from DB, navigate `/apply/resume/{token}` → assert fields are repopulated at the saved step.

- [ ] **Step 5: Verify admin charge**

Log in as an admin, open the submitted loan at `/admin/loans/{id}`, click "Charge saved card" → assert success toast, `fee_charged_at` set, `loan_events` `fee_charged` row, and the payment appears in the Square sandbox dashboard.

- [ ] **Step 6: Record evidence**

Capture screenshots of: the wizard, conditional-field behavior, the submitted page, the new loan in the admin pipeline, and the charged fee. Summarize pass/fail per step. If anything fails, fix before proceeding (route through `superpowers:systematic-debugging`).

---

## Task 17: Security review (mandatory — production-sensitive)

**No files.** Invoke `security-review` on the branch diff.

- [ ] **Step 1: Run the security review**

Focus areas: (a) `/api/apply/*` are unauthenticated by design — confirm they only use the service-role client, never echo/log `data`/SSN, validate and rate-limit; (b) `resume_token` is high-entropy (uuid v4) and is the sole draft authorization — confirm no enumeration/IDOR via `id`; (c) PII at rest — confirm RLS denies anon on `loan_applications` and only service-role reads it; (d) Square — confirm the access token is server-only (never `NEXT_PUBLIC_`), card data never hits our server, idempotency keys used; (e) the admin charge route enforces the admin role check.

- [ ] **Step 2: Triage findings**

Route findings through `superpowers:receiving-code-review`. Fix blocking issues; record accepted risks (e.g., indefinite PII retention is an explicit product decision per spec §8). Re-run build after fixes.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(apply): address security review findings"
```

---

## Self-Review (completed by plan author)

**Spec coverage:** Submission→Supabase rows (Task 6,7); clean-break nullable pipedrive_deal_id (Task 1) + sync guard (Task 15); Square card-on-file later-charge (Task 8,11); fee $45×borrowers (Task 2 helper, used in 8/13); full save&resume (Task 5, 14); typed-name attestation (Task 13 Step 2); 6-step wizard + autosave (Task 9–14); centralized conditional logic (Task 3); all option lists (Task 3); per-borrower declarations/HMDA (Task 10,13; demographics single-row reconciled in Task 7); confirmation + emails (Task 4,7,14); security + E2E (Task 16,17). All spec §10 success criteria map to Task 16 assertions.

**Placeholder scan:** No TBD/TODO. The only deferred item (loan-officer picklist) is explicitly out of v1 scope per spec §9 and handled as `null` in the mapper with a documented rationale — not a placeholder.

**Type consistency:** `ApplicationData`, `FieldDef`, `isVisible/isRequired`, `mapApplication`, `MappedApplication`, `feeCentsForBorrowerCount`, `APPLICATION_LOAN_TYPE_MAP` used consistently across Tasks 3/6/7/9. Data shape (`data.primary`, `data.co_borrowers[]`, `data.units[]`, `data.<dealField>`, `data.cert_*/auth_*`) is consistent between renderer (9), steps (10/12/13), mapper (6), and submit validation (7).

**Build-order caveat documented:** Task 9 intentionally won't build alone; Tasks 9→10→12→13 are one buildable unit with a single commit at the end of Task 13 (noted in Task 9 Step 4).
