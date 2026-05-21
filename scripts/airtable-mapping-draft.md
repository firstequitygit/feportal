# Portal → Airtable Field Mapping (DRAFT)

Base: `appLaBD8QMTXAF0KJ` (First Equity Reports) · Table: `Deals`

## ✓ Auto-mapped (34)

| Portal column | → | Airtable field | Type |
|---|---|---|---|
| `loans.pipedrive_deal_id` | → | **Pipedrive Deal ID** | singleLineText |
| `loans.loan_type` | → | **Loan Type** | singleSelect |
| `loans.loan_amount` | → | **Loan Amount** | currency |
| `loans.interest_rate` | → | **Rate** | percent |
| `loans.arv` | → | **ARV Value** | currency |
| `loans.term_months` | → | **Loan Term** | singleSelect |
| `loans.maturity_date` | → | **Maturity Date ** | date |
| `loans.entity_name` | → | **Entity** | singleLineText |
| `loans.pipeline_stage` | → | **Loan Status** | singleSelect |
| `loans.loan_number` | → | **Loan Number** | singleLineText |
| `loans.estimated_closing_date` | → | **Closing Date** | date |
| `loans.closed_at` | → | **Funding Date** | date |
| `loan_details.property_street` | → | **Property Street** | singleLineText |
| `loan_details.property_city` | → | **Property City** | singleLineText |
| `loan_details.property_state` | → | **Property State** | singleSelect |
| `loan_details.property_zip` | → | **Property ZIP** | singleLineText |
| `loan_details.property_type` | → | **Property Type** | singleSelect |
| `loan_details.number_of_units` | → | **Number of Units** | singleLineText |
| `loan_details.flood_zone` | → | **Flood Zone** | singleSelect |
| `loan_details.loan_type_one` | → | **Loan Type** | singleSelect |
| `loan_details.initial_loan_amount` | → | **Initial Loan Amount** | currency |
| `loan_details.coborrower_name` | → | **Coborrowers** | multipleRecordLinks |
| `loan_details.number_of_properties` | → | **Number of Properties ** | number |
| `loan_details.experience_notes` | → | **Experience Notes** | singleLineText |
| `loan_details.liquid_assets_total` | → | **Verified Assets** | currency |
| `loan_details.foreign_national` | → | **Foreign National** | singleSelect |
| `loan_details.appraisal_company` | → | **Appraiser** | multipleRecordLinks |
| `loan_details.purchase_price` | → | **Purchase Price** | currency |
| `loan_details.acquisition_date` | → | **Acquisition Date** | date |
| `loan_details.value_as_is` | → | **As Is Value** | currency |
| `loan_details.payoff` | → | **Payoff** | singleSelect |
| `loan_details.qualifying_rent` | → | **Qualifying Rent** | currency |
| `loan_details.annual_insurance_premium` | → | **HOI Premium** | currency |
| `loan_details.annual_hoa_dues` | → | **Yearly HOA** | currency |

## ✗ Portal columns NOT mapped (34)

These portal fields had no name match in Airtable Deals. Either map them by hand, or skip.

| Portal column | Why |
|---|---|
| `loans.property_address` | intentionally skipped |
| `loans.ltv` | would map to "LTV" but type=formula is read-only |
| `loans.rehab_budget` | intentionally skipped |
| `loans.origination_date` | intentionally skipped |
| `loans.last_synced_at` | intentionally skipped |
| `loans.rate_locked_days` | intentionally skipped |
| `loans.rate_lock_expiration_date` | intentionally skipped |
| `loans.interest_only` | intentionally skipped |
| `loans.loan_type_ii` | intentionally skipped |
| `loan_details.jotform_submission_id` | intentionally skipped |
| `loan_details.submitted_at` | intentionally skipped |
| `loan_details.square_footage` | hint "Square Footage" not found in Airtable |
| `loan_details.units_vacant` | hint "Units Vacant" not found in Airtable |
| `loan_details.experience_borrower` | intentionally skipped |
| `loan_details.credit_score_estimate` | hint "Credit Score Estimate" not found in Airtable |
| `loan_details.credit_frozen` | hint "Credit Frozen" not found in Airtable |
| `loan_details.own_or_rent` | hint "Own or Rent" not found in Airtable |
| `loan_details.mortgage_on_primary` | hint "Mortgage on Primary" not found in Airtable |
| `loan_details.title_company` | hint "Title Company" not found in Airtable |
| `loan_details.title_email` | hint "Title Email" not found in Airtable |
| `loan_details.title_phone` | hint "Title Phone" not found in Airtable |
| `loan_details.insurance_company` | hint "Insurance Company" not found in Airtable |
| `loan_details.insurance_email` | hint "Insurance Email" not found in Airtable |
| `loan_details.insurance_phone` | hint "Insurance Phone" not found in Airtable |
| `loan_details.appraisal_email` | would map to "Appraiser Email" but type=multipleLookupValues is read-only |
| `loan_details.appraisal_phone` | would map to "Appraiser Phone" but type=multipleLookupValues is read-only |
| `loan_details.vesting_in_entity` | hint "Vesting in Entity" not found in Airtable |
| `loan_details.entity_type` | hint "Entity Type" not found in Airtable |
| `loan_details.entity_formation_state` | hint "Entity Formation State" not found in Airtable |
| `loan_details.down_payment_borrowed` | hint "Down Payment Borrowed" not found in Airtable |
| `loan_details.intent_to_occupy` | hint "Intent to Occupy" not found in Airtable |
| `loan_details.declarations` | intentionally skipped |
| `loan_details.annual_property_tax` | intentionally skipped |
| `loan_details.jotform_submitted_at` | intentionally skipped |
