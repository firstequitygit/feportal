-- Add the 30 columns that exist in the Loan Details UI + API whitelist
-- (src/app/api/loans/field/route.ts) but were never created in the
-- `loan_details` table. Saves to these fields were silently failing — this
-- migration is the prerequisite for both editing them and for the
-- Portal → Airtable sync of Loan Details.
--
-- Type conventions match the existing loan_details columns:
--   - date fields are stored as text (YYYY-MM-DD), like submitted_at /
--     acquisition_date already do
--   - numeric fields use numeric (no precision/scale, to match
--     initial_loan_amount, purchase_price, etc.)
--   - enum fields are plain text (the API validates against validValues)

alter table loan_details
  -- ---- Loan / Deal Overview ----
  add column if not exists investor_loan_number      text,
  add column if not exists loan_application          text,
  add column if not exists urgency                   text,           -- Low | Medium | High | Urgent
  add column if not exists reason_canceled           text,
  add column if not exists underwriter_notes         text,
  add column if not exists exceptions                text,
  add column if not exists cross_collateralization   boolean,

  -- ---- Loan Terms ----
  add column if not exists cash_out_amount           numeric,
  add column if not exists rate_type                 text,           -- Fixed | ARM
  add column if not exists points                    numeric,
  add column if not exists broker_points             numeric,
  add column if not exists underwriting_fee          numeric,
  add column if not exists legal_doc_prep_fee        numeric,
  add column if not exists prepayment_penalty        text,
  add column if not exists amortization_schedule     text,           -- Interest Only | 15-yr | 20-yr | 25-yr | 30-yr
  add column if not exists first_payment_date        text,           -- YYYY-MM-DD

  -- ---- Borrower / Guarantor ----
  add column if not exists coborrower_phone          text,
  add column if not exists coborrower_email          text,
  add column if not exists experience_coborrower     text,
  add column if not exists verified_assets           text,           -- free-form (e.g. "$250k")

  -- ---- Credit / Background ----
  add column if not exists credit_report_date        text,           -- YYYY-MM-DD
  add column if not exists credit_score              numeric,        -- actual pulled score
  add column if not exists background_check_date     text,           -- YYYY-MM-DD
  add column if not exists credit_background_notes   text,

  -- ---- Appraisal / Review Tracking ----
  add column if not exists appraisal_received_date   text,           -- YYYY-MM-DD
  add column if not exists appraisal_effective_date  text,           -- YYYY-MM-DD

  -- ---- Valuation / Collateral ----
  add column if not exists value_bpo                 numeric,

  -- ---- Construction / Rehab ----
  add column if not exists construction_holdback     numeric,
  add column if not exists draw_fee                  numeric,

  -- ---- DSCR inputs (annual_flood_insurance was the only one missing) ----
  add column if not exists annual_flood_insurance    numeric;
