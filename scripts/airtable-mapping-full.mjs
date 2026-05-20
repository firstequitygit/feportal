// Produce a complete side-by-side mapping from every Loan Details UI field
// → best-guess Airtable Deals field, grouped by UI section, so the user can
// confirm or correct each row.
//
// Source of truth for "what's in Loan Details": the FIELD_WHITELIST in
// src/app/api/loans/field/route.ts (85 fields, 11 on loans + 74 on
// loan_details). Source of truth for Airtable side: live schema via API.

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

// Lookup tables
const norm = s => s.toLowerCase().replace(/[\s_\-/().,'"]+/g,'').replace(/[^a-z0-9]/g,'')
const byNorm = new Map()
for (const f of deals.fields) {
  const key = norm(f.name)
  if (!byNorm.has(key)) byNorm.set(key, f)
}

// Explicit hand-curated hints (the only ones I'm sure about — everything else
// gets fuzzy-matched and you'll confirm).  null = intentionally skip.
const HINTS = {
  // ---- Loan / Deal Overview ----
  loan_number:             'Loan Number',
  loan_type:               'Loan Type',
  loan_amount:             'Loan Amount',
  interest_rate:           'Rate',
  ltv:                     null,            // Airtable LTV is a formula (read-only)
  arv:                     'ARV Value',
  rehab_budget:            null,
  term_months:             'Loan Term',     // Airtable singleSelect 12/18/360/480 — value-mapping needed
  origination_date:        null,
  maturity_date:           'Maturity Date ',// note trailing space in Airtable
  entity_name:             'Entity',
  investor_loan_number:    null,
  loan_application:        null,
  submitted_at:            null,
  urgency:                 null,
  reason_canceled:         null,
  underwriter_notes:       'LO Notes',      // closest existing field — confirm
  exceptions:              null,
  cross_collateralization: null,
  foreign_national:        'Foreign National',

  // ---- Property Information ----
  property_street:    'Property Street',
  property_city:      'Property City',
  property_state:     'Property State',
  property_zip:       'Property ZIP',
  property_type:      'Property Type',
  number_of_units:    'Number of Units',
  flood_zone:         'Flood Zone',
  square_footage:     null,
  units_vacant:       null,

  // ---- Loan Terms ----
  initial_loan_amount:    'Initial Loan Amount',
  cash_out_amount:        null,
  rate_type:              null,
  points:                 null,
  broker_points:          null,
  underwriting_fee:       null,
  legal_doc_prep_fee:     null,
  prepayment_penalty:     null,
  amortization_schedule:  null,
  first_payment_date:     null,
  loan_type_one:          'Loan Purpose',  // closest match — confirm

  // ---- Borrower / Guarantor ----
  coborrower_name:        'Coborrowers',           // multipleRecordLinks → Borrowers table
  coborrower_phone:       null,
  coborrower_email:       null,
  experience_borrower:    null,                    // Airtable's is a lookup (read-only)
  experience_coborrower:  null,
  experience_notes:       'Experience Notes',
  number_of_properties:   'Number of Properties ', // note trailing space
  verified_assets:        'Verified Assets',
  liquid_assets_total:    null,                    // separate from verified_assets?

  // ---- Application Profile ----
  own_or_rent:            null,
  mortgage_on_primary:    null,
  intent_to_occupy:       null,
  down_payment_borrowed:  null,

  // ---- Credit / Background ----
  credit_score_estimate:   null,
  credit_frozen:           null,
  credit_report_date:      'Credit Date',
  credit_score:            null,                    // Airtable's Credit Score is a lookup
  background_check_date:   null,
  credit_background_notes: 'Credit/Background Notes',

  // ---- Appraisal / Review Tracking ----
  appraisal_received_date:  'Appraisal Received Date',
  appraisal_effective_date: null,

  // ---- Valuation / Collateral ----
  purchase_price:    'Purchase Price',
  acquisition_date:  'Acquisition Date',
  value_as_is:       'As Is Value',
  value_bpo:         null,
  payoff:            null,                          // Airtable Payoff is a singleSelect status field, not currency

  // ---- Construction / Rehab ----
  construction_holdback: null,
  draw_fee:              null,

  // ---- DSCR inputs ----
  qualifying_rent:           'Qualifying Rent',
  annual_insurance_premium:  'HOI Premium',
  annual_property_tax:       null,                  // Airtable has Monthly Property Tax (need conversion)
  annual_flood_insurance:    null,
  annual_hoa_dues:           'Yearly HOA',

  // ---- Title / Insurance / Appraiser (linked tables, special handling) ----
  title_company:     '[LINK] Title',
  title_email:       null,                          // read-only lookup from Title table
  title_phone:       null,                          // read-only lookup from Title table
  insurance_company: '[LINK] Insurance',
  insurance_email:   null,                          // read-only lookup from Insurance table
  insurance_phone:   null,                          // read-only lookup from Insurance table
  appraisal_company: '[LINK] Appraiser',
  appraisal_email:   null,                          // read-only lookup from Appraisers table
  appraisal_phone:   null,                          // read-only lookup from Appraisers table

  // ---- Vesting Entity ----
  vesting_in_entity:      null,
  entity_type:            null,
  entity_formation_state: null,
}

// Parse FIELD_WHITELIST to get the canonical 85-field list grouped by section
const route = readFileSync('src/app/api/loans/field/route.ts', 'utf8')
const block = route.split('const FIELD_WHITELIST')[1].split('export async')[0]
const sections = []
let current = null
for (const line of block.split('\n')) {
  const sectionMatch = line.match(/^\s*\/\/\s*(={3,}|-{3,})\s*([^=\-].*?)\s*(={3,}|-{3,}|$)/) ||
                       line.match(/^\s*\/\/\s*-+\s*(.+?)\s*-*\s*$/) ||
                       line.match(/^\s*\/\/\s+([A-Z][^/]+)$/)
  if (sectionMatch) {
    const name = (sectionMatch[2] ?? sectionMatch[1]).trim()
    current = { name, fields: [] }
    sections.push(current)
    continue
  }
  const fieldMatch = line.match(/^\s+([a-z_]+):\s*\{[^}]*\}/)
  if (fieldMatch && current) {
    current.fields.push(fieldMatch[1])
  }
}

// Fall back: any field not yet in a section goes to "Other"
const seen = new Set(sections.flatMap(s => s.fields))
const allFields = [...block.matchAll(/^\s+([a-z_]+):\s*\{/gm)].map(m => m[1])
const other = allFields.filter(f => !seen.has(f))
if (other.length) sections.push({ name: 'Other', fields: other })

// Build the table
let md = `# Loan Details → Airtable Deals Mapping (please confirm/correct)\n\n`
md += `Base \`appLaBD8QMTXAF0KJ\` · Table \`Deals\` (tbl0Dg6YE96oD9dDq)\n\n`
md += `**For each row, reply with:**\n`
md += `- ✅ to confirm my guess\n`
md += `- ❌ to skip (don't sync this field)\n`
md += `- A different Airtable field name to use a different mapping\n\n`
md += `Legend: \`[LINK]\` means we'll find-or-create a linked record in another table (Title / Insurance / Appraisers) and link to it. \`?\` means I'm guessing — please verify the name.\n\n`

let total = 0
let guessed = 0
let skipped = 0
for (const sec of sections) {
  if (sec.fields.length === 0) continue
  md += `## ${sec.name}\n\n`
  md += `| Portal field | Best-guess Airtable field | Type | Notes |\n|---|---|---|---|\n`
  for (const f of sec.fields) {
    total++
    let target = HINTS[f]
    let isGuess = false
    if (target === undefined) {
      const m = byNorm.get(norm(f))
      target = m?.name ?? null
      isGuess = !!target
    }
    if (target === null) {
      skipped++
      md += `| \`${f}\` | _(skip)_ | — | no obvious match |\n`
      continue
    }
    if (target.startsWith('[LINK]')) {
      md += `| \`${f}\` | **${target}** | linked record | will find/create row in linked table |\n`
      guessed++
      continue
    }
    const at = deals.fields.find(x => x.name === target)
    if (!at) {
      md += `| \`${f}\` | **${target}** ❓ | NOT FOUND | hint doesn't match an Airtable field |\n`
      continue
    }
    const ro = READ_ONLY.has(at.type) ? ' ⚠️ read-only' : ''
    md += `| \`${f}\` | **${at.name}**${isGuess ? ' ?' : ''} | ${at.type}${ro} | ${describe(at)} |\n`
    guessed++
  }
  md += `\n`
}

md += `---\n\n**Summary:** ${guessed} mapped · ${skipped} skipped · ${total} total\n`
writeFileSync('scripts/loan-details-mapping.md', md)
console.log(`Wrote scripts/loan-details-mapping.md — ${total} fields (${guessed} guessed, ${skipped} skipped)`)

function describe(f) {
  if (f.type === 'singleSelect' || f.type === 'multipleSelects') {
    const c = (f.options?.choices ?? []).map(x => x.name).slice(0, 5).join(' / ')
    return c + ((f.options?.choices?.length ?? 0) > 5 ? ' ...' : '')
  }
  if (f.type === 'multipleRecordLinks') {
    const t = tables.find(t => t.id === f.options?.linkedTableId)
    return `→ ${t?.name ?? '?'} table`
  }
  return ''
}
