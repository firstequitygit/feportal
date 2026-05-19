# Loan Application Intake — Design Spec

**Date:** 2026-05-19
**Status:** Approved (design); pending implementation plan
**Author:** Brainstormed with apalmiotto@outlook.com

## 1. Purpose

Build a public-facing, multi-step loan application form for the First Equity
Portal that captures borrower personal details, deal information, experience,
declarations, authorization, and payment, and lands the data **directly in
Supabase** (no Pipedrive). It replaces the current JotForm intake as the new
front door for loan applications.

## 2. Key Decisions (locked)

| Decision | Choice |
|---|---|
| Submission destination | **Supabase only, no Pipedrive** |
| Pipedrive coexistence | **Clean break** — Supabase becomes source of truth; Pipedrive sync left legacy, not removed in this build |
| Payment processor | **Square** (Web Payments SDK + Customers/Cards API) |
| Payment timing | **Card-on-file, charged later by staff** (no charge at submit) |
| Fee logic | **$45 × number of borrowers** (primary + co-borrowers; borrower count structurally capped at 4 → fee range $45–$180) |
| Save & resume | **Full server-side**, tokenized resume link emailed; **drafts retained indefinitely (never auto-deleted)** |
| Signature | **Typed name + checkbox attestation** (ESIGN/UETA valid) |
| Form UX | **6-step wizard** with progress bar + autosave per step |
| App↔portal data model | **Approach 1**: `loan_applications` is the draft/intake layer; on submit it spawns the canonical `borrowers`/`loans`/`loan_details`/`loan_demographics` rows the portal already reads |

## 3. Architecture

### 3.1 Routes
- `src/app/apply/page.tsx` — public, **no auth check** (only public page in the app). Renders the client wizard.
- `src/app/apply/resume/[token]/page.tsx` — loads a draft by `resume_token` and hydrates the wizard.
- `src/app/apply/_steps/` — one component per step (Step1Borrower … Step6Payment).
- `src/app/apply/_components/` — wizard shell, progress bar, autosave hook, repeating-section helpers.

### 3.2 API endpoints (all public except the staff charge route)
- `POST /api/apply/draft` — create draft, return `{ id, resume_token }`, email resume link.
- `PATCH /api/apply/draft` — autosave `data` jsonb + `current_step` (auth by `resume_token` in body). Drafts are never auto-deleted (no cleanup cron).
- `POST /api/apply/payment` — exchange Square card token → create Square Customer + save Card on File → persist `square_customer_id`, `square_card_id`, `fee_amount_cents`.
- `POST /api/apply/submit` — server-side re-validate → run `application-mapper.ts` → insert canonical rows in a transaction → mark draft `submitted` → audit + emails.
- `POST /api/admin/loans/[id]/charge-fee` — **admin-only** (existing role-check pattern). Charges the saved Square card, records `fee_charged_at` + `loan_events` row.

### 3.3 New table: `loan_applications`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `status` | text | `draft` \| `submitted` |
| `current_step` | int | 1–6, for resume |
| `resume_token` | uuid | indexed, unguessable; sole gate for draft access |
| `resume_email` | text | where the resume link was sent |
| `data` | jsonb | entire form state incl. co-borrowers[] and units[] arrays |
| `square_customer_id` | text | null until payment step completed |
| `square_card_id` | text | null until payment step completed |
| `fee_amount_cents` | int | computed $45 × borrower count |
| `fee_charged_at` | timestamptz | null until staff charges |
| `submitted_loan_id` | uuid FK→loans.id | null until submit |
| `created_at` / `updated_at` | timestamptz | |

RLS: anon denied; all access via service-role client in API routes. The `data`
jsonb (SSN, DOB) is **never** written to Pipedrive or logs.

### 3.4 Schema migration (`supabase/migrations/2026-05-19-loan-applications.sql`)
- Create `loan_applications` (above).
- `ALTER TABLE loans ALTER COLUMN pipedrive_deal_id DROP NOT NULL;` (keep UNIQUE — NULLs are allowed under a unique constraint in Postgres).
- Change the Pipedrive sync cron (`/api/cron/sync`) to only upsert/touch rows where `pipedrive_deal_id IS NOT NULL`, so it never overwrites or deletes application-origin loans.

### 3.5 Submit pipeline — `src/lib/application-mapper.ts`
Structural twin of `src/lib/jotform-mapper.ts` but Supabase-only. Input:
`loan_applications.data`. Output rows:
- **`borrowers`** — 1 primary + up to 3 co-borrowers (`auth_user_id` NULL until staff invites via existing `invite-borrower` flow).
- **`loans`** — `borrower_id` / `borrower_id_2` / `_3` / `_4`, `pipeline_stage='New Application'`, `pipedrive_deal_id=NULL`, `loan_amount` = Requested Loan Amount, `property_address`, `entity_name`, and `loan_type` mapped from the form's Loan Type display label to the existing `LoanType` enum / `loans.loan_type` CHECK values: **Fix & Flip/Renovation → `Fix & Flip (Bridge)`**, **DSCR Rental Loan → `Rental (DSCR)`**, **New Construction → `New Construction`**.
- **`loan_details`** — the large field bag; reuse existing columns (mirror the column set written by `jotform-mapper.ts` `loanDetails`).
- **`loan_demographics`** — HMDA ethnicity/race/sex per borrower.
- Insert one `loan_events` audit row (`event_type`, `description`) per the codebase convention.

Confirmation page after submit (no portal login created — staff invites the
borrower later). Emails: applicant confirmation + selected loan-officer
notification via existing `src/lib/email.ts` pattern.

## 4. Conditional Logic (centralized)

All show/hide and required-when rules live in **one** module:
`src/lib/application-fields.ts`. Each field is declared with metadata and an
optional `visibleWhen(data)` / `requiredWhen(data)` predicate. Step components
render only what this module reports visible. Refining rules later = editing
this one table, not the step components.

### 4.1 v1 baseline rules
- **Loan Type = Fix & Flip/Renovation | New Construction** → show Renovation/Construction Budget, After Repaired Value, Exit Strategy; hide DSCR rent fields.
- **Loan Type = DSCR Rental Loan** → show rent fields (per-unit); hide renovation budget.
- **Exit Strategy = Other (Explain Below)** → show an Exit Strategy explanation textarea.
- **Purchase or Refi = Purchase** → show Purchase Price, Date Purchased. **= Refi** → show Is There Current Debt, Current Loan Balance, Has Debt Been Current Past 24 Months.
- **Number of Units (1–4)** → render exactly that many Unit rent blocks (Currently Rented / Current Rent / Market Rent / Lease Type). DSCR or multifamily only.
- **Lived at current address < 2 years** → show Prior Address (per borrower).
- **Outside mortgage broker = Yes** → Broker Name/Email/Phone/Fee.
- **Preferred title vendor = Yes** → Title Company/Contact Name/Email/Phone.
- **Preferred property-insurance vendor = Yes** → Insurance Company/Contact Name/Email/Phone.
- **Is there a co-borrower? / Add co-borrower** → render co-borrower blocks (Steps 1, 3, 4) per co-borrower added (max 3 co = 4 total).

### 4.2 v1 scope on conditional logic
Ship the centralized engine + baseline rules. Fields not yet cleanly ruled
(e.g., finer Bridge-vs-DSCR financial nuances) are shown **unconditionally**
(no data lost) and flagged here as **"rules to refine together post-v1."**
Nothing is hard-coded in a way that makes later tuning painful.

## 5. Field Inventory by Step

Field set reconciled from the Cognito mockup PDF and the existing
`jotform-mapper.ts` contract. All dropdown option lists live in
`application-fields.ts`.

### 5.1 Option Lists

**Confirmed (final):**
- **Estimated Credit Score:** `> 780`, `760-779`, `740-759`, `720-739`, `700-719`, `680-699`, `660-679`, `640-659`, `620-639`, `600-619`, `< 599`
- **Loan Type:** `Fix & Flip/Renovation`, `New Construction`, `DSCR Rental Loan`
- **Property Type:** `Single Family`, `Condo`, `Multifamily (2-4 Units)`, `Multifamily (5+ Units)`, `Mixed Use`, `Other Commercial`
- **Exit Strategy:** `Sell`, `Refinance`, `Other (Explain Below)` (Other → explanation textarea)
- **Deal Source:** `Short Sale`, `Bank Owned (REO)`, `Sheriff Sale`, `MLS`, `Foreclosure Auction`, `Wholesaler`, `Direct from Seller`, `Other`
- **How did you hear about us?:** `Internet Search (Google, Bing, etc.)`, `Social Media (Facebook, Instagram, etc.)`, `YouTube`, `Email Marketing`, `Text Message`, `Phone Call`, `Direct Mail`, `Networking Event`, `Realtor Referral`, `Broker Referral`, `Other Referral`, `3rd Party Website`, `3rd Party Publication`, `Other`
- **Lease Type** (per rental unit): `Annual`, `Month-to-Month`, `Short Term/Vacation Rental`, `Vacant`
- **Other Real Estate Experience:** `Realtor`, `Contractor`, `Wholesaler`, `Real Estate Attorney`, `Mortgage Broker/Lender`
- **Fix & Flips / Fix & Holds Completed Last 3 Years:** `0`, `1 - 2`, `3 - 10`, `11+`

**Defaulted (will use these unless changed during implementation):**
- **Marital Status:** `Married`, `Single`, `Separated` (from current JotForm)
- **Purchase or Refi:** `Purchase`, `Refinance`, `Cash-Out Refinance`
- **Do you have a deal? / Is there a co-borrower? / Mortgage on primary? / Housing Status:** Yes/No (Housing Status: `Own`, `Rent`)
- **Entity Type:** `LLC`, `Corporation`, `Limited Partnership`, `Other`
- **HMDA Ethnicity / Race / Sex:** standard federal HMDA value sets

All option lists are now confirmed by the product owner. No open list items remain.

### Step 1 — Borrower Info
Primary borrower: Name (First/Middle/Last)\*, Date of Birth\*, SSN\*, U.S.
Citizen?\* (Y/N), Permanent Resident Alien?\* (Y/N), Current legal status,
Marital Status (Married/Single/Separated), Email\*, Cell Phone\*, Other Phone,
Address\* (Line1/City/State/Zip), Lived here 2 years?\* (Y/N), Prior Address
(if <2y), Estimated Credit Score (range dropdown), Housing Status (dropdown),
Mortgage on primary? (dropdown), Entity Name, Entity Type (dropdown), First
Equity Loan Officer\* (from `loan_officers`), How did you hear about us?\*
(dropdown), Details, Is there a co-borrower?\* (dropdown). Hidden constant:
Admin Email = `info@fefunding.com`.
Co-Borrower (repeating ×0–3): Name\*, DOB\*, SSN\*, Credit Score\* (dropdown),
U.S. Citizen?\*, Permanent Resident Alien?\*, Foreign national?\*, Current
legal status\*, Email\*, Cell Phone\*, Other Phone, Address\*, Lived here 2
years?\*, Prior Address (if <2y).

### Step 2 — Deal Info
Do you have a deal?\* (dropdown), Purchase or Refi\* (dropdown), Loan Type\*
(Fix & Flip (Bridge) / Rental (DSCR) / New Construction), Property Type\*
(SFR / Condo / 2-4 Unit / Multifamily / Mixed Use / Commercial), Property
Sub-Type\*, Property Address\* (Line1/City/State/Zip), Deal Source (dropdown),
Date Purchased, Original Purchase Price, Renovations Completed, Current Value\*,
Is There Current Debt? (Y/N), Has Debt Been Current Past 24 Months (Y/N),
Current Loan Balance, Purchase Price\*, Construction Costs\* (conditional),
After Repaired Value\* (conditional), Exit Strategy (conditional), Requested
Loan Amount, Cash For Down Payment, Reserves Post Closing, Number of Units
(1–4), Units 1–4 (repeating: Currently Rented Y/N, Current Rent, Market Rent,
Lease Type), Total Monthly Rents (All Units), Property Rent Roll/P&L (file
upload — reuse existing signed-URL upload pattern), Annual Property Taxes,
Annual Property Insurance, Monthly Flood Insurance, Monthly HOA Dues, Outside
mortgage broker? (Y/N), Broker Name/Email/Phone/Fee (conditional), Preferred
title vendor? (Y/N), Title Company/Contact Name/Email/Phone (conditional),
Preferred property-insurance vendor? (Y/N), Insurance Company/Contact
Name/Email/Phone (conditional), Other Details (textarea).

### Step 3 — Experience
Per borrower (primary + each co-borrower): Fix & Flips/Holds Completed Last 3
Years (dropdown), Number of Rental Units Currently Owned (int), Other Real
Estate Experience (dropdown), Experience Explanation (textarea).

### Step 4 — Declarations
Per borrower (primary + each co-borrower), Yes/No: outstanding
liens/judgements; bankruptcy/foreclosure past 4 yrs; presently delinquent on
debt/lien/mortgage; obligated on a loan that resulted in
foreclosure/title-in-lieu/judgement; party to a lawsuit; down payment
borrowed; US Citizen; permanent resident alien; foreign national; intend to
occupy subject property. Plus "If yes to any, please explain" (textarea).
HMDA Government Monitoring per borrower: Ethnicity (radio + Additional
Details), Race (radio + Additional Details ×2), Sex (radio).

### Step 5 — Authorization
Static Certification text + Authorization to Release Information text. Borrower
Printed Name (auto = primary name), Date (auto = today), Signature\* (typed
name attestation). Second static block: background check / appraisal / draw
inspection / processing fee authorization. Printed Name (auto), Date (auto),
Signature\* (typed name attestation).

### Step 6 — Payment
Credit & Background Check line item = **$45 × borrower count** (max $180),
auto-computed and displayed. Square Web Payments SDK card field → tokenize →
save Card on File. **No charge at submit.** Consent covered by Step 5
authorization text.

## 6. Save & Resume Mechanics
- Draft row created when applicant enters email in Step 1 (on blur).
- Autosave: on every step advance + every ~20s of edits → `PATCH /api/apply/draft`.
- Resume email: `sendApplicationResumeEmail(email, token, firstName)` added to `src/lib/email.ts`; link = `/apply/resume/{token}`.
- **Drafts are retained indefinitely — never auto-deleted.** No expiry, no cleanup cron. Resume links remain valid until the application is submitted (or a staff member manually removes it). PII in abandoned drafts persists by product decision; noted in §8 as an accepted retention trade-off.

## 7. Payment & Staff Charge
- `NEXT_PUBLIC_SQUARE_APPLICATION_ID`, `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_ENVIRONMENT` (sandbox|production) added to env.
- Square Node SDK added to `package.json`.
- Admin loan-detail page: "Charge Credit & Background Fee" button shown when a saved card exists and `fee_charged_at` is null → `POST /api/admin/loans/[id]/charge-fee` → Square Payments API → record `fee_charged_at` + `loan_events`.

## 8. Security (production-sensitive)
- Public `/api/apply/*` endpoints: rate-limiting + lightweight bot check.
- Draft access gated solely by high-entropy `resume_token` (uuid v4).
- PII (SSN, DOB) in `data` jsonb, Supabase only; service-role access; anon RLS deny; never logged, never sent to Pipedrive.
- **Accepted retention trade-off:** drafts (incl. PII) are kept indefinitely per product decision. Mitigations: high-entropy resume tokens, RLS anon-deny, no PII in logs, service-role-only reads. Staff manual deletion is the only purge path; an admin "delete draft" affordance can be added post-v1 if desired.
- Card data handled entirely by Square (PCI SAQ-A scope); our DB stores only Square IDs + fee.
- **This change touches payments + PII**: requires a Phase-5 `security-review` and a real end-to-end Phase-6 verification before merge. Flag at the plan gate.

## 9. Out of Scope (v1, explicit)
- Removing JotForm webhook / Pipedrive cron (left legacy; separate decommission).
- Auto-provisioning borrower portal logins on submit (staff invites later).
- Perfecting every conditional rule (baseline only; refine together post-v1).
- Drawn-canvas signatures (typed attestation only).

## 10. Success Criteria
1. A public applicant can complete all 6 steps and submit; canonical rows appear in the existing portal pipeline at "New Application" with no portal code changes.
2. Leaving mid-application and clicking the emailed resume link restores all entered data at the correct step.
3. Conditional fields show/hide per the §4.1 baseline; all rules live in `application-fields.ts`.
4. Square card is saved on file (no charge at submit); staff can later charge the fee from the admin loan detail page and see `fee_charged_at` recorded.
5. `npm run build` passes (TypeScript + ESLint — the project's correctness gate).
6. Security review passes for the public endpoints, resume-token model, and PII/payment handling.
