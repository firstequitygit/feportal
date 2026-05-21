// Generate a CSV of the Loan Details → Airtable mapping draft for review in
// Excel. Columns are sized so the user can add a Notes column and a
// Decision column without rearranging anything.
import { readFileSync, writeFileSync } from 'node:fs'
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const TOKEN = process.env.AIRTABLE_TOKEN
const BASE = 'appLaBD8QMTXAF0KJ'
const TABLE_ID = 'tbl0Dg6YE96oD9dDq'

const READ_ONLY = new Set([
  'formula','rollup','count','lookup','multipleLookupValues',
  'createdTime','createdBy','lastModifiedTime','lastModifiedBy',
  'autoNumber','button','externalSyncSource','aiText',
])

const res = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables`, {
  headers: { Authorization: `Bearer ${TOKEN}` },
})
const { tables } = await res.json()
const deals = tables.find(t => t.id === TABLE_ID)
const tableNameById = new Map(tables.map(t => [t.id, t.name]))

// Same hints as the .md generator (kept in sync by hand for now)
const HINTS = {
  loan_number: 'Loan Number', loan_type: 'Loan Type', loan_amount: 'Loan Amount',
  interest_rate: 'Rate', ltv: null, arv: 'ARV Value', rehab_budget: null,
  term_months: 'Loan Term', origination_date: null, maturity_date: 'Maturity Date ',
  entity_name: 'Entity',
  investor_loan_number: null, loan_application: null, submitted_at: null,
  urgency: null, reason_canceled: null, underwriter_notes: 'LO Notes',
  exceptions: null, cross_collateralization: null, foreign_national: 'Foreign National',
  property_street: 'Property Street', property_city: 'Property City',
  property_state: 'Property State', property_zip: 'Property ZIP',
  property_type: 'Property Type', number_of_units: 'Number of Units',
  flood_zone: 'Flood Zone', square_footage: null, units_vacant: null,
  initial_loan_amount: 'Initial Loan Amount', cash_out_amount: null,
  rate_type: null, points: null, broker_points: null, underwriting_fee: null,
  legal_doc_prep_fee: null, prepayment_penalty: null, amortization_schedule: null,
  first_payment_date: null, loan_type_one: 'Loan Purpose',
  coborrower_name: 'Coborrowers', coborrower_phone: null, coborrower_email: null,
  experience_borrower: null, experience_coborrower: null,
  experience_notes: 'Experience Notes', number_of_properties: 'Number of Properties ',
  verified_assets: 'Verified Assets', liquid_assets_total: null,
  own_or_rent: null, mortgage_on_primary: null, intent_to_occupy: null,
  down_payment_borrowed: null,
  credit_score_estimate: null, credit_frozen: null,
  credit_report_date: 'Credit Date', credit_score: null,
  background_check_date: null, credit_background_notes: 'Credit/Background Notes',
  appraisal_received_date: 'Appraisal Received Date', appraisal_effective_date: null,
  purchase_price: 'Purchase Price', acquisition_date: 'Acquisition Date',
  value_as_is: 'As Is Value', value_bpo: null, payoff: null,
  construction_holdback: null, draw_fee: null,
  qualifying_rent: 'Qualifying Rent', annual_insurance_premium: 'HOI Premium',
  annual_property_tax: null, annual_flood_insurance: null,
  annual_hoa_dues: 'Yearly HOA',
  title_company: '[LINK] Title', title_email: null, title_phone: null,
  insurance_company: '[LINK] Insurance', insurance_email: null, insurance_phone: null,
  appraisal_company: '[LINK] Appraiser', appraisal_email: null, appraisal_phone: null,
  vesting_in_entity: null, entity_type: null, entity_formation_state: null,
}

// UI section labels keyed by the route.ts header comments
const SECTIONS = [
  { name: '🏷 Loan Overview (loans table)', fields: ['loan_number','loan_type','loan_amount','interest_rate','ltv','arv','rehab_budget','term_months','origination_date','maturity_date','entity_name'] },
  { name: '📋 Loan / Deal Overview', fields: ['investor_loan_number','loan_application','submitted_at','urgency','reason_canceled','underwriter_notes','exceptions','cross_collateralization','foreign_national'] },
  { name: '🏠 Property Information', fields: ['property_street','property_city','property_state','property_zip','property_type','number_of_units','flood_zone','square_footage','units_vacant'] },
  { name: '💵 Loan Terms', fields: ['initial_loan_amount','cash_out_amount','rate_type','points','broker_points','underwriting_fee','legal_doc_prep_fee','prepayment_penalty','amortization_schedule','first_payment_date','loan_type_one'] },
  { name: '👥 Borrower / Guarantor', fields: ['coborrower_name','coborrower_phone','coborrower_email','experience_borrower','experience_coborrower','experience_notes','number_of_properties','verified_assets','liquid_assets_total'] },
  { name: '📊 Application Profile', fields: ['own_or_rent','mortgage_on_primary','intent_to_occupy','down_payment_borrowed'] },
  { name: '💳 Credit / Background', fields: ['credit_score_estimate','credit_frozen','credit_report_date','credit_score','background_check_date','credit_background_notes'] },
  { name: '🏛 Appraisal / Review Tracking', fields: ['appraisal_received_date','appraisal_effective_date'] },
  { name: '💎 Valuation / Collateral', fields: ['purchase_price','acquisition_date','value_as_is','value_bpo','payoff'] },
  { name: '🚧 Construction / Rehab', fields: ['construction_holdback','draw_fee'] },
  { name: '📈 DSCR Inputs', fields: ['qualifying_rent','annual_insurance_premium','annual_property_tax','annual_flood_insurance','annual_hoa_dues'] },
  { name: '🔗 Vendors (linked tables)', fields: ['title_company','title_email','title_phone','insurance_company','insurance_email','insurance_phone','appraisal_company','appraisal_email','appraisal_phone'] },
  { name: '🏢 Vesting Entity', fields: ['vesting_in_entity','entity_type','entity_formation_state'] },
]

// CSV escaping
const q = v => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const rows = [
  ['Section','#','Portal Field','Best-Guess Airtable Field','Airtable Type','Writable?','Auto-Notes','Your Notes','Decision (✓ / ✗ / new name)'],
]
let n = 0
for (const sec of SECTIONS) {
  for (const f of sec.fields) {
    n++
    const target = HINTS[f]
    let atName = '', atType = '', writable = '', autoNotes = ''
    if (target === null || target === undefined) {
      atName = ''
      autoNotes = 'no obvious match - confirm or paste Airtable field name'
    } else if (target.startsWith('[LINK]')) {
      atName = target
      atType = 'linked record'
      writable = 'YES (via find/create in linked table)'
      autoNotes = 'will find or create row in linked table and link to Deal'
    } else {
      atName = target
      const at = deals.fields.find(x => x.name === target)
      if (at) {
        atType = at.type
        writable = READ_ONLY.has(at.type) ? 'NO (read-only)' : 'YES'
        if (at.type === 'singleSelect' || at.type === 'multipleSelects') {
          autoNotes = 'choices: ' + (at.options?.choices ?? []).map(c => c.name).join(' / ')
        } else if (at.type === 'multipleRecordLinks') {
          autoNotes = '→ ' + (tableNameById.get(at.options?.linkedTableId) ?? '?') + ' table'
        }
      } else {
        autoNotes = 'hint did not match an Airtable field — verify name'
      }
    }
    rows.push([sec.name, n, f, atName, atType, writable, autoNotes, '', ''])
  }
}

const csv = rows.map(r => r.map(q).join(',')).join('\n')
// Excel on Windows handles UTF-8 with BOM cleanly (emoji / unicode in section names)
writeFileSync('scripts/loan-details-mapping.csv', '﻿' + csv)
console.log(`Wrote scripts/loan-details-mapping.csv (${rows.length - 1} fields)`)
