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
    // PRIMARY_EXTRA_FIELDS that are required
    loan_officer_assigned: 'Anthony Palmiotto',
    hear_about_us: 'Internet Search (Google, Bing, etc.)',
    housing_status: 'Own',
    mortgage_on_primary: true,
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

/** Overlay broker-only fields onto a scenario for /broker/apply test mode.
 *  Adds broker identity to primary, swaps the borrower's auth/payment
 *  signatures (Step 5 borrower) for the broker_attestation_signature
 *  (Step 5 broker), and leaves the rest of the borrower data intact. */
export function applyBrokerOverlay(data: ApplicationData): ApplicationData {
  const primary = (data.primary as Record<string, unknown>) ?? {}
  const broker = randomName()
  const brokerEmail = randomEmail(broker.first, broker.last)
  const next: ApplicationData = {
    ...data,
    primary: {
      ...primary,
      brokerage_name: 'Acme Test Brokerage LLC',
      broker_email: brokerEmail,
      broker_phone: randomPhone(),
      broker_license_number: String(1000000 + Math.floor(Math.random() * 9000000)),
      broker_license_state: 'NJ',
      commission_split_percent: 50,
      commission_paid_by: 'Lender',
      referral_source: 'Broker Referral',
    },
    broker_attestation_signature: `${broker.first} ${broker.last}`,
  }
  // Borrower-side signatures are not collected on the broker variant — drop
  // them so the server-side broker validator does not see stale values.
  delete (next as Record<string, unknown>).auth_signature
  delete (next as Record<string, unknown>).payment_signature
  return next
}
