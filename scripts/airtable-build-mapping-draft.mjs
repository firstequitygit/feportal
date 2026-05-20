// Build a draft Portal → Airtable field mapping for the Deals table.
//
// - Pulls Airtable Deals schema (315 fields)
// - Pulls portal `loans` and `loan_details` column lists from Postgres
// - Auto-pairs by case/punctuation-insensitive name match, with a few hand
//   hints for fields where the names differ by convention.
// - Writes scripts/airtable-mapping-draft.json + a human-readable .md
//   for review.
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const TOKEN = process.env.AIRTABLE_TOKEN
const BASE = 'appLaBD8QMTXAF0KJ'
const TABLE_ID = 'tbl0Dg6YE96oD9dDq'

// 1. Airtable schema
const schemaRes = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables`, {
  headers: { Authorization: `Bearer ${TOKEN}` },
})
const { tables } = await schemaRes.json()
const deals = tables.find(t => t.id === TABLE_ID)
const airtableFields = deals.fields.map(f => ({ name: f.name, type: f.type }))
console.log(`Airtable Deals fields: ${airtableFields.length}`)

// 2. Portal columns (loans + loan_details). Use information_schema via RPC-style
//    direct query through a simple .from('information_schema.columns') won't
//    work with PostgREST so we hard-code from a quick supa select with limit 0.
const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)
async function columnNames(table) {
  const { data, error } = await supa.from(table).select('*').limit(1)
  if (error) { console.error(table, error); process.exit(1) }
  return data?.[0] ? Object.keys(data[0]) : []
}
function colsFromSchemaSql(tableName) {
  const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
  const re = new RegExp(`create table if not exists ${tableName} \\(([\\s\\S]*?)\\);`, 'i')
  const m = sql.match(re)
  if (!m) return []
  return [...m[1].matchAll(/^\s{2}([a-z_]+)\s+/gm)].map(x => x[1])
    .filter(c => c !== 'id')
}
const loansCols = await columnNames('loans')
let loanDetailsCols = await columnNames('loan_details')
if (loanDetailsCols.length === 0) {
  loanDetailsCols = colsFromSchemaSql('loan_details')
  // Add appraiser columns from the more-recent migration if not already there
  for (const c of ['appraisal_company','appraisal_email','appraisal_phone']) {
    if (!loanDetailsCols.includes(c)) loanDetailsCols.push(c)
  }
}
console.log(`Portal loans columns: ${loansCols.length}`)
console.log(`Portal loan_details columns: ${loanDetailsCols.length}`)

// 3. Normalize for matching (snake_case ↔ Title Case insensitive)
function norm(s) {
  return s.toLowerCase().replace(/[\s_\-/().]+/g, '').replace(/[^a-z0-9]/g, '')
}

const airtableByNorm = new Map(airtableFields.map(f => [norm(f.name), f]))

// Airtable types we CANNOT write to (computed or system-managed).
const READ_ONLY_TYPES = new Set([
  'formula', 'rollup', 'count', 'lookup', 'multipleLookupValues',
  'createdTime', 'createdBy', 'lastModifiedTime', 'lastModifiedBy',
  'autoNumber', 'button', 'externalSyncSource', 'aiText',
])

// 4. Hand-hints where portal column ≠ Airtable name 1:1.
// null = intentionally skip. Otherwise the value must match an Airtable field name exactly.
const HINTS = {
  // ---- loans ----
  pipedrive_deal_id: 'Pipedrive Deal ID',
  loan_number: 'Loan Number',
  loan_amount: 'Loan Amount',
  loan_type: 'Loan Type',
  loan_type_ii: null,                  // removed from portal UI
  pipeline_stage: 'Loan Status',
  estimated_closing_date: 'Closing Date',
  closed_at: 'Funding Date',
  interest_rate: 'Rate',
  arv: 'ARV Value',
  rehab_budget: null,                 // not in Airtable (probably a hidden field — check)
  term_months: 'Loan Term',           // Airtable is a singleSelect (12/18/360/480 months) — value-mapping needed
  origination_date: null,             // not visible in Airtable
  entity_name: 'Entity',
  property_address: null,              // built from Street/City/State/ZIP in Airtable
  last_synced_at: null,                // internal-only
  rate_locked_days: null,
  rate_lock_expiration_date: null,
  interest_only: null,
  // ---- loan_details ----
  property_street: 'Property Street',
  property_city: 'Property City',
  property_state: 'Property State',
  property_zip: 'Property ZIP',
  property_type: 'Property Type',
  number_of_units: 'Number of Units',
  flood_zone: 'Flood Zone',
  square_footage: 'Square Footage',
  units_vacant: 'Units Vacant',
  loan_type_one: 'Loan Type',
  initial_loan_amount: 'Initial Loan Amount',
  coborrower_name: 'Coborrowers',                  // multipleRecordLinks → Borrowers table (special handling)
  experience_borrower: null,                        // Airtable's "Experience (Borrower)" is a lookup (read-only)
  number_of_properties: 'Number of Properties ',    // note trailing space — that's the actual Airtable name
  experience_notes: 'Experience Notes',
  liquid_assets_total: 'Verified Assets',
  foreign_national: 'Foreign National',
  credit_score_estimate: 'Credit Score Estimate',
  credit_frozen: 'Credit Frozen',
  own_or_rent: 'Own or Rent',
  mortgage_on_primary: 'Mortgage on Primary',
  title_company: 'Title Company',
  title_email: 'Title Email',
  title_phone: 'Title Phone',
  insurance_company: 'Insurance Company',
  insurance_email: 'Insurance Email',
  insurance_phone: 'Insurance Phone',
  appraisal_company: 'Appraiser',         // Airtable links to Appraisers table
  appraisal_email: 'Appraiser Email',
  appraisal_phone: 'Appraiser Phone',
  vesting_in_entity: 'Vesting in Entity',
  entity_type: 'Entity Type',
  entity_formation_state: 'Entity Formation State',
  down_payment_borrowed: 'Down Payment Borrowed',
  intent_to_occupy: 'Intent to Occupy',
  declarations: null,                  // JSON blob, not 1:1
  purchase_price: 'Purchase Price',
  acquisition_date: 'Acquisition Date',
  value_as_is: 'As Is Value',
  payoff: 'Payoff',
  qualifying_rent: 'Qualifying Rent',
  annual_property_tax: null,           // Airtable has Monthly Property Tax + Yearly (formula). Need decision.
  annual_insurance_premium: 'HOI Premium',
  annual_hoa_dues: 'Yearly HOA',
  jotform_submission_id: null,
  submitted_at: null,
  jotform_submitted_at: null,
  updated_at: null,
}

// 5. Build the mapping
const mapping = []
const unmapped = []
const SOURCE_TABLES = [
  { table: 'loans', cols: loansCols },
  { table: 'loan_details', cols: loanDetailsCols },
]
const skipPortalCols = new Set([
  'id', 'created_at', 'updated_at', 'archived',
  // FKs handled separately
  'borrower_id','borrower_id_2','borrower_id_3','borrower_id_4',
  'loan_officer_id','loan_processor_id','loan_processor_id_2',
  'underwriter_id','broker_id','broker_id_2','loan_id','auth_user_id',
])

for (const { table, cols } of SOURCE_TABLES) {
  for (const col of cols) {
    if (skipPortalCols.has(col)) continue
    let match = null
    let reason = ''
    if (col in HINTS) {
      const target = HINTS[col]
      if (target == null) { unmapped.push({ portal: `${table}.${col}`, reason: 'intentionally skipped' }); continue }
      match = airtableFields.find(f => f.name === target)
      if (!match) reason = `hint "${target}" not found in Airtable`
    } else {
      match = airtableByNorm.get(norm(col))
      if (!match) reason = 'no name match'
    }
    if (match) {
      if (READ_ONLY_TYPES.has(match.type)) {
        unmapped.push({ portal: `${table}.${col}`, reason: `would map to "${match.name}" but type=${match.type} is read-only` })
      } else {
        mapping.push({ portal: `${table}.${col}`, airtable: match.name, airtableType: match.type })
      }
    } else {
      unmapped.push({ portal: `${table}.${col}`, reason })
    }
  }
}

console.log(`\nAuto-mapped: ${mapping.length}`)
console.log(`Unmapped portal columns: ${unmapped.length}`)

// 6. Write outputs
writeFileSync('scripts/airtable-mapping-draft.json', JSON.stringify({ mapping, unmapped }, null, 2))

let md = `# Portal → Airtable Field Mapping (DRAFT)\n\n`
md += `Base: \`appLaBD8QMTXAF0KJ\` (First Equity Reports) · Table: \`Deals\`\n\n`
md += `## ✓ Auto-mapped (${mapping.length})\n\n`
md += `| Portal column | → | Airtable field | Type |\n|---|---|---|---|\n`
for (const m of mapping) md += `| \`${m.portal}\` | → | **${m.airtable}** | ${m.airtableType} |\n`
md += `\n## ✗ Portal columns NOT mapped (${unmapped.length})\n\n`
md += `These portal fields had no name match in Airtable Deals. Either map them by hand, or skip.\n\n`
md += `| Portal column | Why |\n|---|---|\n`
for (const u of unmapped) md += `| \`${u.portal}\` | ${u.reason} |\n`
writeFileSync('scripts/airtable-mapping-draft.md', md)

console.log('\nWrote scripts/airtable-mapping-draft.json + .md')
