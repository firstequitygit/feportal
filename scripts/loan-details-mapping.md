# Loan Details → Airtable Deals Mapping (please confirm/correct)

Base `appLaBD8QMTXAF0KJ` · Table `Deals` (tbl0Dg6YE96oD9dDq)

**For each row, reply with:**
- ✅ to confirm my guess
- ❌ to skip (don't sync this field)
- A different Airtable field name to use a different mapping

Legend: `[LINK]` means we'll find-or-create a linked record in another table (Title / Insurance / Appraisers) and link to it. `?` means I'm guessing — please verify the name.

## loans table (synced to Pipedrive)

| Portal field | Best-guess Airtable field | Type | Notes |
|---|---|---|---|
| `loan_number` | **Loan Number** | singleLineText |  |
| `loan_type` | **Loan Type** | singleSelect | New Construction / DSCR / Bridge |
| `loan_amount` | **Loan Amount** | currency |  |
| `interest_rate` | **Rate** | percent |  |
| `ltv` | _(skip)_ | — | no obvious match |
| `arv` | **ARV Value** | currency |  |
| `rehab_budget` | _(skip)_ | — | no obvious match |
| `term_months` | **Loan Term** | singleSelect | 12 Months / 18 Months / 360 Months / 480 Months |
| `origination_date` | _(skip)_ | — | no obvious match |
| `maturity_date` | **Maturity Date ** | date |  |
| `entity_name` | **Entity** | singleLineText |  |

## loan_details table (portal-only, no Pipedrive sync)

| Portal field | Best-guess Airtable field | Type | Notes |
|---|---|---|---|
| `investor_loan_number` | _(skip)_ | — | no obvious match |
| `loan_application` | _(skip)_ | — | no obvious match |
| `submitted_at` | _(skip)_ | — | no obvious match |
| `urgency` | _(skip)_ | — | no obvious match |
| `reason_canceled` | _(skip)_ | — | no obvious match |
| `underwriter_notes` | **LO Notes** | richText |  |
| `exceptions` | _(skip)_ | — | no obvious match |
| `cross_collateralization` | _(skip)_ | — | no obvious match |
| `foreign_national` | **Foreign National** | singleSelect | Yes / No |

## Property Information

| Portal field | Best-guess Airtable field | Type | Notes |
|---|---|---|---|
| `property_street` | **Property Street** | singleLineText |  |
| `property_city` | **Property City** | singleLineText |  |
| `property_state` | **Property State** | singleSelect | AL / AR / CO / CT / DE ... |
| `property_zip` | **Property ZIP** | singleLineText |  |
| `property_type` | **Property Type** | singleSelect | Single Family / 2 - 4 Unit / Multi Family / Condo / Mixed Use ... |
| `number_of_units` | **Number of Units** | singleLineText |  |
| `flood_zone` | **Flood Zone** | singleSelect | Yes / No |

## Loan Terms

| Portal field | Best-guess Airtable field | Type | Notes |
|---|---|---|---|
| `initial_loan_amount` | **Initial Loan Amount** | currency |  |
| `cash_out_amount` | _(skip)_ | — | no obvious match |
| `rate_type` | _(skip)_ | — | no obvious match |
| `points` | _(skip)_ | — | no obvious match |
| `broker_points` | _(skip)_ | — | no obvious match |
| `underwriting_fee` | _(skip)_ | — | no obvious match |
| `legal_doc_prep_fee` | _(skip)_ | — | no obvious match |
| `prepayment_penalty` | _(skip)_ | — | no obvious match |
| `amortization_schedule` | _(skip)_ | — | no obvious match |
| `first_payment_date` | _(skip)_ | — | no obvious match |
| `coborrower_name` | **Coborrowers** | multipleRecordLinks | → Borrowers table |
| `coborrower_phone` | _(skip)_ | — | no obvious match |
| `coborrower_email` | _(skip)_ | — | no obvious match |
| `experience_borrower` | _(skip)_ | — | no obvious match |
| `experience_coborrower` | _(skip)_ | — | no obvious match |
| `experience_notes` | **Experience Notes** | singleLineText |  |
| `number_of_properties` | **Number of Properties ** | number |  |
| `verified_assets` | **Verified Assets** | currency |  |
| `credit_report_date` | **Credit Date** | date |  |
| `credit_score` | _(skip)_ | — | no obvious match |
| `background_check_date` | _(skip)_ | — | no obvious match |
| `credit_background_notes` | **Credit/Background Notes** | singleLineText |  |
| `appraisal_received_date` | **Appraisal Received Date** | date |  |
| `appraisal_effective_date` | _(skip)_ | — | no obvious match |
| `purchase_price` | **Purchase Price** | currency |  |
| `acquisition_date` | **Acquisition Date** | date |  |
| `value_as_is` | **As Is Value** | currency |  |
| `value_bpo` | _(skip)_ | — | no obvious match |
| `payoff` | _(skip)_ | — | no obvious match |
| `construction_holdback` | _(skip)_ | — | no obvious match |
| `draw_fee` | _(skip)_ | — | no obvious match |

## DSCR inputs

| Portal field | Best-guess Airtable field | Type | Notes |
|---|---|---|---|
| `qualifying_rent` | **Qualifying Rent** | currency |  |
| `annual_insurance_premium` | **HOI Premium** | currency |  |
| `annual_property_tax` | _(skip)_ | — | no obvious match |
| `annual_flood_insurance` | _(skip)_ | — | no obvious match |
| `annual_hoa_dues` | **Yearly HOA** | currency |  |

## Property Information additions

| Portal field | Best-guess Airtable field | Type | Notes |
|---|---|---|---|
| `square_footage` | _(skip)_ | — | no obvious match |
| `units_vacant` | _(skip)_ | — | no obvious match |
| `loan_type_one` | **Loan Purpose** | singleSelect | Purchase / Delayed Purchase / Rate/Term Refi / Cash Out Refi |
| `liquid_assets_total` | _(skip)_ | — | no obvious match |
| `credit_score_estimate` | _(skip)_ | — | no obvious match |
| `credit_frozen` | _(skip)_ | — | no obvious match |

## Application Profile (borrower-side flags from the loan application)

| Portal field | Best-guess Airtable field | Type | Notes |
|---|---|---|---|
| `own_or_rent` | _(skip)_ | — | no obvious match |
| `mortgage_on_primary` | _(skip)_ | — | no obvious match |
| `intent_to_occupy` | _(skip)_ | — | no obvious match |
| `down_payment_borrowed` | _(skip)_ | — | no obvious match |

## Title, Insurance, Appraiser contact info

| Portal field | Best-guess Airtable field | Type | Notes |
|---|---|---|---|
| `title_company` | **[LINK] Title** | linked record | will find/create row in linked table |
| `title_email` | _(skip)_ | — | no obvious match |
| `title_phone` | _(skip)_ | — | no obvious match |
| `insurance_company` | **[LINK] Insurance** | linked record | will find/create row in linked table |
| `insurance_email` | _(skip)_ | — | no obvious match |
| `insurance_phone` | _(skip)_ | — | no obvious match |
| `appraisal_company` | **[LINK] Appraiser** | linked record | will find/create row in linked table |
| `appraisal_email` | _(skip)_ | — | no obvious match |
| `appraisal_phone` | _(skip)_ | — | no obvious match |

## Vesting Entity (entity_name itself stays on loans table — it syncs to Pipedrive)

| Portal field | Best-guess Airtable field | Type | Notes |
|---|---|---|---|
| `vesting_in_entity` | _(skip)_ | — | no obvious match |
| `entity_type` | _(skip)_ | — | no obvious match |
| `entity_formation_state` | _(skip)_ | — | no obvious match |

---

**Summary:** 35 mapped · 50 skipped · 85 total
