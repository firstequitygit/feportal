/**
 * JotForm submission → portal data mapper.
 *
 * JotForm webhooks send a multipart POST with a `rawRequest` field containing
 * a JSON string of the submission. Keys in that JSON are formatted like
 * `q{N}_{slug}{N}` where N is the JotForm-internal question ID. Composite
 * widgets (Name / Address / Date) come back as nested objects; radio fields
 * come back as one-element arrays like `["Yes"]`.
 *
 * The mapper looks up fields by exact `q{N}_` prefix, with a slug substring
 * fallback in case JotForm renumbers a question after a form edit.
 */

import {
  PIPEDRIVE_FIELDS,
  PIPEDRIVE_LOAN_TYPE_MAP,
  type LoanType,
} from './types'

type RawRequest = Record<string, unknown>

export interface MappedSubmission {
  pipedrivePerson: {
    name: string
    email: string | null
    phone: string | null
    ssn: string | null
    birthDate: string | null              // YYYY-MM-DD
    usCitizenLabel: string | null         // 'Yes' / 'No' — resolved to option ID by caller
    maritalStatusLabel: string | null     // 'Married' / 'Single' / 'Separated'
  }
  pipedriveDeal: {
    title: string                         // subject property full address
    value: number | null                  // loan amount in USD
    currency: 'USD'
    customFields: Record<string, string | number | null>
  }
  loanDetails: Record<string, unknown>
  loanDemographics: {
    ethnicity: string | null
    race: string | null
    sex: string | null
  }
  borrower: {
    full_name: string
    email: string | null
    phone: string | null
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
  loanType: LoanType | null
  meta: {
    submissionId: string | null
    propertyAddress: string
    /** Loan officer the borrower selected in the form; matched to a row by name in the webhook. */
    loanOfficerName: string | null
  }
  /** Keys from rawRequest the mapper didn't consume — diagnostic. */
  unmapped: Record<string, unknown>
}

// ───────────── Helpers ─────────────

function findByNumber(raw: RawRequest, n: number): { key: string; value: unknown } | null {
  const k = Object.keys(raw).find(key => key.startsWith(`q${n}_`))
  if (k && raw[k] !== undefined && raw[k] !== '') return { key: k, value: raw[k] }
  return null
}

function findBySlug(raw: RawRequest, slug: string): { key: string; value: unknown } | null {
  const lower = slug.toLowerCase()
  const k = Object.keys(raw).find(key => key.toLowerCase().includes(lower))
  if (k && raw[k] !== undefined && raw[k] !== '') return { key: k, value: raw[k] }
  return null
}

function asString(val: unknown): string | null {
  if (val === null || val === undefined) return null
  if (typeof val === 'string') {
    const t = val.trim()
    return t === '' ? null : t
  }
  if (typeof val === 'number') return String(val)
  if (Array.isArray(val)) {
    if (val.length === 0) return null
    return asString(val[0])
  }
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>
    if (typeof obj.value === 'string') return obj.value.trim() || null
    if (typeof obj.full === 'string') return obj.full.trim() || null
  }
  return null
}

function asNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null
  if (typeof val === 'number') return val
  if (Array.isArray(val)) {
    if (val.length === 0) return null
    return asNumber(val[0])
  }
  if (typeof val === 'string') {
    const cleaned = val.replace(/[$,\s]/g, '')
    if (cleaned === '') return null
    const n = Number(cleaned)
    return isNaN(n) ? null : n
  }
  return null
}

function asYesNo(val: unknown): boolean | null {
  const s = asString(val)
  if (!s) return null
  const lower = s.toLowerCase()
  if (lower === 'yes') return true
  if (lower === 'no') return false
  return null
}

function asName(val: unknown): { first: string; last: string; full: string } | null {
  if (!val || typeof val !== 'object' || Array.isArray(val)) {
    const s = asString(val)
    return s ? { first: s, last: '', full: s } : null
  }
  const obj = val as Record<string, unknown>
  const first = (asString(obj.first) ?? '').trim()
  const middle = (asString(obj.middle) ?? '').trim()
  const last = (asString(obj.last) ?? '').trim()
  const suffix = (asString(obj.suffix) ?? '').trim()
  const parts = [first, middle, last, suffix].filter(Boolean)
  if (parts.length === 0) return null
  return { first, last, full: parts.join(' ') }
}

function asAddress(val: unknown): {
  street: string | null
  city: string | null
  state: string | null
  zip: string | null
  full: string
} | null {
  if (!val || typeof val !== 'object' || Array.isArray(val)) {
    const s = asString(val)
    return s ? { street: s, city: null, state: null, zip: null, full: s } : null
  }
  const obj = val as Record<string, unknown>
  const line1 = (asString(obj.addr_line1) ?? '').trim()
  const line2 = (asString(obj.addr_line2) ?? '').trim()
  const city = (asString(obj.city) ?? '').trim() || null
  const state = (asString(obj.state) ?? '').trim() || null
  const zip = (asString(obj.postal) ?? '').trim() || null
  const street = [line1, line2].filter(Boolean).join(', ') || null
  const fullParts = [street, city, state, zip].filter(Boolean) as string[]
  const full = fullParts.join(', ')
  if (!street && !city && !state && !zip) return null
  return { street, city, state, zip, full }
}

function asDate(val: unknown): string | null {
  if (!val) return null
  if (typeof val === 'object' && !Array.isArray(val)) {
    const obj = val as Record<string, unknown>
    const m = asString(obj.month)
    const d = asString(obj.day)
    const y = asString(obj.year)
    if (m && d && y) {
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    }
  }
  const s = asString(val)
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if (m) {
    const [, mm, dd, yyyy] = m
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
  }
  return null
}

function resolveLoanType(label: string | null): { name: LoanType | null; optionId: number | null } {
  if (!label) return { name: null, optionId: null }
  const lower = label.toLowerCase()
  let name: LoanType | null = null
  if (lower.includes('dscr')) name = 'DSCR'
  else if (lower.includes('bridge')) name = 'Bridge'
  else if (lower.includes('ground up') || lower.includes('construction')) name = 'New Construction'
  else if (lower.includes('flip')) name = 'Fix & Flip'

  if (!name) return { name: null, optionId: null }
  const optionId = Object.entries(PIPEDRIVE_LOAN_TYPE_MAP)
    .find(([, n]) => n === name)?.[0]
  return { name, optionId: optionId ? Number(optionId) : null }
}

function resolvePropertyType(label: string | null): string | null {
  if (!label) return null
  const lower = label.toLowerCase()
  if (lower.includes('sfr') || lower.includes('townhome')) return 'SFR'
  if (lower.includes('condo')) return 'Condo'
  if (lower.includes('2-4') || lower.includes('2 to 4')) return '2-4 Unit'
  if (lower.includes('5+') || lower.includes('5 or more') || lower.includes('multi')) return 'Multifamily'
  if (lower.includes('mixed')) return 'Mixed Use'
  if (lower.includes('commercial')) return 'Commercial'
  return null
}

// ───────────── Main mapper ─────────────

export function mapJotForm(raw: RawRequest, submissionId: string | null): MappedSubmission {
  const consumedKeys = new Set<string>()
  const consumeMetadataKey = (k: string) => { if (k in raw) consumedKeys.add(k) }

  /**
   * Look up a field by JotForm question number first (most reliable);
   * fall back to a slug substring if the question has been renumbered.
   * Marks the matched key as consumed (even if empty) so the unmapped
   * diagnostic only shows truly unrecognised keys.
   */
  const get = (questionNumber: number, ...fallbackSlugs: string[]): unknown => {
    const byNumKey = Object.keys(raw).find(k => k.startsWith(`q${questionNumber}_`))
    if (byNumKey !== undefined) {
      consumedKeys.add(byNumKey)
      const v = raw[byNumKey]
      return v === '' ? undefined : v
    }
    for (const slug of fallbackSlugs) {
      const lower = slug.toLowerCase()
      const slugKey = Object.keys(raw).find(k => k.toLowerCase().includes(lower))
      if (slugKey !== undefined) {
        consumedKeys.add(slugKey)
        const v = raw[slugKey]
        return v === '' ? undefined : v
      }
    }
    return undefined
  }

  // ===== Loan Application — applicant identity =====
  const name = asName(get(3, 'yourName'))
  const fullName = name?.full ?? 'Unknown Applicant'

  const ssn = asString(get(93, 'socialSecurity'))
  const birthDate = asDate(get(76, 'birthDate'))
  const usCitizen = asString(get(94))                     // q94_areYou — slug too generic
  const phone = asString(get(7, 'phoneNumber'))
  const email = asString(get(8, 'email'))
  const creditScoreEstimate = asNumber(get(166, 'estimateCredit'))
  const creditFrozen = asYesNo(get(173))                  // q173_areAny173
  const loanOfficerName = asString(get(182, 'loanOfficer'))

  // ===== Borrower address =====
  const currentAddr = asAddress(get(9, 'address'))
  const lived2y = asYesNo(get(96))                        // q96_haveYou96
  const priorAddr = asAddress(get(162, 'priorAddress'))
  const ownOrRent = asString(get(10))                     // q10_doYou (own/rent)
  const mortgageOnPrimary = asYesNo(get(98))              // q98_isThere
  const _q71 = get(71); void _q71                         // co-borrower yes/no — implicit in q72 having a value
  const coBorrowerName = asString(get(72))                // q72_ifYes72
  const maritalStatus = asString(get(6, 'maritalStatus'))

  // ===== Liquid Assets — sum to single number =====
  const checkingSavings = asNumber(get(40, 'moneyIn')) ?? 0
  const cashOnHand = asNumber(get(41, 'cashOn')) ?? 0
  const retirement = asNumber(get(42, '401k')) ?? 0
  const liquidAssetsTotal = checkingSavings + cashOnHand + retirement || null

  // ===== Loan Detail Information =====
  const loanTypeIRaw = asString(get(104, 'loanType'))     // Purchase / Refi etc.
  const loanTypeIIRaw = asString(get(105, 'loanType105')) // Bridge / DSCR / Construction
  const subjectAddr = asAddress(get(107, 'subjectProperty'))
  const propertyTypeRaw = asString(get(108, 'propertyType'))
  const squareFootage = asNumber(get(159, 'squareFootage'))
  const floodZone = asYesNo(get(161, 'floodZone'))
  const purchasePrice = asNumber(get(109, 'purchasePrice'))
  const purchaseDate = asDate(get(112, 'purchaseDate'))
  const estimateValue = asNumber(get(113, 'estimateValue'))
  const payoffEstimate = asNumber(get(165, 'payoffEstimate'))
  const rehabAmount = asNumber(get(110, 'rehab'))
  const arv = asNumber(get(111, 'afterRepair'))
  const monthlyRent = asNumber(get(32, 'netRental'))
  const annualInsurance = asNumber(get(34, 'annualInsurance'))
  const annualTaxes = asNumber(get(39, 'annualTaxes'))
  const annualHoa = asNumber(get(97, 'annualHoa'))
  const numberOfUnits = asNumber(get(116))                // q116_numberOf
  const unitsVacant = asYesNo(get(117))                   // q117_areAny
  const requestedLoanAmount = asNumber(get(114, 'requestedLoan'))
  const titleCompany = asString(get(167, 'titleCompany'))
  const titleEmail = asString(get(168, 'titleEmail'))
  const titlePhone = asString(get(169, 'titlePhone'))
  const insuranceCompany = asString(get(170, 'insuranceCompany'))
  const insuranceEmail = asString(get(171, 'insuranceEmail'))
  const insurancePhone = asString(get(172, 'insurancePhone'))

  // ===== Vesting Business Entity =====
  const vestingInEntity = asYesNo(get(58))                // q58_doYou58
  const businessName = asString(get(78))                  // q78_ifYes78
  const entityType = asString(get(61))                    // q61_isThis (LLC or Inc)
  const entityFormationState = asString(get(62))          // q62_inWhat

  // ===== Experience =====
  const flipsLast3y = asNumber(get(119))                  // q119_howMany
  const rentalsOwned = asNumber(get(120))                 // q120_numberOf120
  const rentalsLast3y = asNumber(get(121))                // q121_howMany121
  const rentalSample = asString(get(180))                 // q180_addressOf
  const otherExperience = asString(get(123))              // q123_anyOther

  // ===== Declarations (1-9) — collected into single JSONB =====
  const declarations = {
    outstanding_judgements:    asYesNo(get(51)),  // q51_1Are
    bankruptcy_or_foreclosure: asYesNo(get(52)),  // q52_2Have52
    delinquent_debt:           asYesNo(get(53)),  // q53_3Are
    delinquent_federal_debt:   asYesNo(get(125)), // q125_4Are
    party_to_lawsuit:          asYesNo(get(54)),  // q54_5Are
    landlord_action:           asYesNo(get(55)),  // q55_6Have
    down_payment_borrowed:     asYesNo(get(56)),  // q56_656
    foreign_national:          asYesNo(get(126)), // q126_8Are
    intent_to_occupy:          asYesNo(get(127)), // q127_9Do
    explanation:               asString(get(87)), // q87_ifYes87
  }

  // ===== Demographics =====
  const ethnicity = asString(get(129, 'guarantorEthnicity'))
  const race = asString(get(130, 'guarantorRace'))
  const sex = asString(get(131, 'guarantorSex'))

  // ===== Mark known JotForm metadata keys as consumed =====
  for (const k of [
    'slug', 'jsExecutionTracker', 'submitSource', 'submitDate', 'buildDate',
    'uploadServerUrl', 'eventObserver', 'formOpenId_V5', 'event_id',
    'timeToSubmit', 'validatedNewRequiredFieldIDs', 'visitedPages', 'path',
  ]) consumeMetadataKey(k)
  // Signature + final attestation widgets: large base64, no useful mapping
  consumeMetadataKey('q158_yourSignature')
  consumeMetadataKey('q139_fullName')
  consumeMetadataKey('q138_date')
  consumeMetadataKey('q176_cardHolder')
  consumeMetadataKey('q178_date178')

  // ===== Resolutions =====
  const loanType = resolveLoanType(loanTypeIIRaw)
  const propertyType = resolvePropertyType(propertyTypeRaw)
  // Deal title: just the street address (line 1 + line 2). Pipedrive
  // convention is a short title; city/state/zip are still captured on
  // loan_details.property_city / state / zip for display elsewhere.
  const dealTitle = subjectAddr?.street ?? `Application — ${fullName}`

  // ===== Build Pipedrive deal custom fields =====
  const dealCustomFields: Record<string, string | number | null> = {}
  if (requestedLoanAmount !== null) dealCustomFields[PIPEDRIVE_FIELDS.loanAmount] = requestedLoanAmount
  if (loanType.optionId !== null)   dealCustomFields[PIPEDRIVE_FIELDS.loanType] = loanType.optionId
  if (loanTypeIIRaw)                dealCustomFields[PIPEDRIVE_FIELDS.loanTypeII] = loanTypeIIRaw
  if (arv !== null)                 dealCustomFields[PIPEDRIVE_FIELDS.arv] = arv
  if (rehabAmount !== null)         dealCustomFields[PIPEDRIVE_FIELDS.rehabBudget] = rehabAmount
  if (businessName)                 dealCustomFields[PIPEDRIVE_FIELDS.entityName] = businessName

  // ===== Build loan_details row =====
  const loanDetails: Record<string, unknown> = {
    submitted_at: new Date().toISOString().slice(0, 10),

    // Property Information
    property_street: subjectAddr?.street ?? null,
    property_city:   subjectAddr?.city ?? null,
    property_state:  subjectAddr?.state ?? null,
    property_zip:    subjectAddr?.zip ?? null,
    property_type:   propertyType,
    number_of_units: numberOfUnits,
    flood_zone:      floodZone === null ? null : floodZone ? 'Yes' : 'No',
    square_footage:  squareFootage,
    units_vacant:    unitsVacant,

    // Loan Terms
    loan_type_one:   loanTypeIRaw,
    initial_loan_amount: requestedLoanAmount,

    // Borrower / Guarantor
    coborrower_name:        coBorrowerName,
    experience_borrower:    flipsLast3y !== null ? `${flipsLast3y} fix & flip / hold projects (last 3 yrs)` : null,
    number_of_properties:   rentalsOwned,
    experience_notes:       [
      rentalsLast3y !== null ? `Rentals purchased in last 3 yrs: ${rentalsLast3y}` : null,
      rentalSample ? `Rental sample: ${rentalSample}` : null,
      otherExperience ? `Other experience: ${otherExperience}` : null,
    ].filter(Boolean).join('\n') || null,
    liquid_assets_total:    liquidAssetsTotal,
    foreign_national:       declarations.foreign_national,

    // Credit / Background
    credit_score_estimate: creditScoreEstimate,
    credit_frozen:         creditFrozen,

    // Borrower-side flags
    own_or_rent:        ownOrRent,
    mortgage_on_primary: mortgageOnPrimary,

    // Title & Insurance
    title_company:     titleCompany,
    title_email:       titleEmail,
    title_phone:       titlePhone,
    insurance_company: insuranceCompany,
    insurance_email:   insuranceEmail,
    insurance_phone:   insurancePhone,

    // Vesting Entity
    vesting_in_entity:       vestingInEntity,
    entity_type:             entityType,
    entity_formation_state:  entityFormationState,

    // Application-stage flags
    down_payment_borrowed: declarations.down_payment_borrowed,
    intent_to_occupy:      declarations.intent_to_occupy,

    declarations,

    // Valuation / Collateral
    purchase_price:   purchasePrice,
    acquisition_date: purchaseDate,
    value_as_is:      estimateValue,
    payoff:           payoffEstimate,

    // DSCR inputs
    qualifying_rent:           monthlyRent,
    annual_property_tax:       annualTaxes,
    annual_insurance_premium:  annualInsurance,
    annual_hoa_dues:           annualHoa,

    // JotForm tracking
    jotform_submission_id: submissionId,
    jotform_submitted_at:  new Date().toISOString(),
  }

  // ===== Unmapped fields (for debugging) =====
  const unmapped: RawRequest = {}
  for (const [k, v] of Object.entries(raw)) {
    if (!consumedKeys.has(k)) unmapped[k] = v
  }

  return {
    pipedrivePerson: {
      name: fullName,
      email,
      phone,
      ssn,
      birthDate,
      usCitizenLabel: usCitizen,
      maritalStatusLabel: maritalStatus,
    },
    pipedriveDeal: {
      title: dealTitle,
      value: requestedLoanAmount,
      currency: 'USD',
      customFields: dealCustomFields,
    },
    loanDetails,
    loanDemographics: { ethnicity, race, sex },
    borrower: {
      full_name: fullName,
      email,
      phone,
      current_address_street: currentAddr?.street ?? null,
      current_address_city:   currentAddr?.city ?? null,
      current_address_state:  currentAddr?.state ?? null,
      current_address_zip:    currentAddr?.zip ?? null,
      at_current_address_2y:  lived2y,
      prior_address_street:   priorAddr?.street ?? null,
      prior_address_city:     priorAddr?.city ?? null,
      prior_address_state:    priorAddr?.state ?? null,
      prior_address_zip:      priorAddr?.zip ?? null,
    },
    loanType: loanType.name,
    meta: {
      submissionId,
      propertyAddress: dealTitle,
      loanOfficerName,
    },
    unmapped,
  }
}
