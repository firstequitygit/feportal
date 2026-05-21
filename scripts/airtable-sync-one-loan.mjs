// Single-loan reconcile (Model B: fill blanks only, never overwrite).
// Reports every per-field decision so you can spot-check the sync logic
// before turning the cron loose.
//
// Usage:
//   node scripts/airtable-sync-one-loan.mjs                  # auto-pick a loan
//   node scripts/airtable-sync-one-loan.mjs <loanId>         # specific portal loan id
//   node scripts/airtable-sync-one-loan.mjs --deal <dealId>  # by Pipedrive deal id
//   node scripts/airtable-sync-one-loan.mjs --dry            # dry-run: report decisions, write nothing
//
// (Re)implements just enough of src/lib/airtable.ts to run from plain node,
// since the real module uses Next.js path aliases.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const TOKEN = process.env.AIRTABLE_TOKEN
const BASE  = 'appLaBD8QMTXAF0KJ'
const DEALS = 'tbl0Dg6YE96oD9dDq'
const DRY   = process.argv.includes('--dry')

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

// ---- transforms (mirror src/lib/airtable-field-map.ts) ----
const fwd = {
  loanType: v => v === 'Fix & Flip (Bridge)' ? 'Bridge' : v === 'Rental (DSCR)' ? 'DSCR' : v === 'New Construction' ? 'New Construction' : undefined,
  termMonths: v => [12,18,360,480].includes(Number(v)) ? `${Number(v)} Months` : undefined,
  boolYN: v => v === true ? 'Yes' : v === false ? 'No' : undefined,
  passYN: v => v === 'Yes' || v === 'No' ? v : undefined,
  rateType: v => v === 'Fixed' ? 'fixed' : v === 'ARM' ? '5 yr ARM' : undefined,
  annualToMonthly: v => { const n = Number(v); return Number.isFinite(n) ? Math.round(n/12*100)/100 : undefined },
  rate: v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? (n >= 1 ? n/100 : n) : undefined },
  points: v => { const n = Number(v); return Number.isFinite(n) ? (n >= 1 ? n/100 : n) : undefined },
  verifiedAssets: v => { if (typeof v !== 'string') return undefined; const n = Number(v.replace(/[^0-9.\-]/g,'')); return Number.isFinite(n) && n > 0 ? n : undefined },
  numToText: v => v == null ? undefined : String(v),
}
const inv = {
  loanType: v => typeof v !== 'string' ? undefined : v === 'Bridge' ? 'Fix & Flip (Bridge)' : v === 'DSCR' ? 'Rental (DSCR)' : v === 'New Construction' ? 'New Construction' : undefined,
  termMonths: v => { if (typeof v !== 'string') return undefined; const m = v.match(/^(\d+)\s*Months?$/i); return m ? Number(m[1]) : undefined },
  ynToBool: v => v === 'Yes' ? true : v === 'No' ? false : undefined,
  passYN: v => v === 'Yes' || v === 'No' ? v : undefined,
  rateType: v => { if (typeof v !== 'string') return undefined; if (v.toLowerCase() === 'fixed') return 'Fixed'; if (/arm$/i.test(v)) return 'ARM'; return undefined },
  monthlyToAnnual: v => { const n = Number(v); return Number.isFinite(n) ? Math.round(n*12*100)/100 : undefined },
  rate: v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : undefined },
  points: v => { const n = Number(v); return Number.isFinite(n) ? (n < 1 ? Math.round(n*100*1000)/1000 : n) : undefined },
  verifiedAssets: v => { const n = Number(v); return Number.isFinite(n) ? String(n) : undefined },
  textToInt: v => { if (typeof v !== 'string') return undefined; const n = parseInt(v,10); return Number.isFinite(n) ? n : undefined },
}

// [tbl, portalCol, airtableField, fwdFn?, invFn?]
const MAP = [
  ['loans','loan_number','Loan Number'],
  ['loans','loan_type','Loan Type', fwd.loanType, inv.loanType],
  ['loans','loan_amount','Loan Amount'],
  ['loans','interest_rate','Rate', fwd.rate, inv.rate],
  ['loans','arv','ARV Value'],
  ['loans','rehab_budget','Construction Cost'],
  ['loans','term_months','Loan Term', fwd.termMonths, inv.termMonths],
  ['loans','origination_date','Closing Date'],
  ['loans','maturity_date','Maturity Date '],
  ['loans','entity_name','Entity'],
  ['loan_details','investor_loan_number','Investor Loan Number'],
  ['loan_details','submitted_at','Submitted'],
  ['loan_details','urgency','Urgency'],
  ['loan_details','underwriter_notes',"Alicyn's Notes"],
  ['loan_details','exceptions','Exceptions'],
  ['loan_details','cross_collateralization','Cross Collaterization Flag ', fwd.boolYN, inv.ynToBool],
  ['loan_details','foreign_national','Foreign National', fwd.boolYN, inv.ynToBool],
  ['loan_details','property_street','Property Street'],
  ['loan_details','property_city','Property City'],
  ['loan_details','property_state','Property State'],
  ['loan_details','property_zip','Property ZIP'],
  ['loan_details','property_type','Property Type'],
  ['loan_details','number_of_units','Number of Units', fwd.numToText, inv.textToInt],
  ['loan_details','flood_zone','Flood Zone', fwd.passYN, inv.passYN],
  ['loan_details','initial_loan_amount','Initial Loan Amount'],
  ['loan_details','cash_out_amount','Cash Out Amt'],
  ['loan_details','rate_type','Rate Type', fwd.rateType, inv.rateType],
  ['loan_details','points','Points'],
  ['loan_details','broker_points','Broker Points', fwd.points, inv.points],
  ['loan_details','prepayment_penalty','Prepayment Penalty'],
  ['loan_details','first_payment_date','First Payment Date'],
  ['loan_details','loan_type_one','Loan Purpose'],
  ['loan_details','experience_notes','Experience Notes'],
  ['loan_details','number_of_properties','Number of Properties '],
  ['loan_details','verified_assets','Verified Assets', fwd.verifiedAssets, inv.verifiedAssets],
  ['loan_details','credit_report_date','Credit Date'],
  ['loan_details','credit_background_notes','Credit/Background Notes'],
  ['loan_details','appraisal_received_date','Appraisal Received Date'],
  ['loan_details','purchase_price','Purchase Price'],
  ['loan_details','acquisition_date','Acquisition Date'],
  ['loan_details','value_as_is','As Is Value'],
  ['loan_details','value_bpo','BPO Value'],
  ['loan_details','construction_holdback','Construction Holdback'],
  ['loan_details','qualifying_rent','Qualifying Rent'],
  ['loan_details','annual_insurance_premium','HOI Premium'],
  ['loan_details','annual_property_tax','Monthly Property Tax', fwd.annualToMonthly, inv.monthlyToAnnual],
  ['loan_details','annual_flood_insurance','Flood Insurance'],
  ['loan_details','annual_hoa_dues','Yearly HOA'],
]

const VENDORS = [
  { co: 'title_company', em: 'title_email', ph: 'title_phone', link: 'Title', table: 'tblXZ6ucTk9FOotTM' },
  { co: 'insurance_company', em: 'insurance_email', ph: 'insurance_phone', link: 'Insurance', table: 'tbl6iKk1BFElA3zCD' },
  { co: 'appraisal_company', em: 'appraisal_email', ph: 'appraisal_phone', link: 'Appraiser', table: 'tblaDSAbqrH32EBQN' },
]

const isEmpty = v => v === null || v === undefined || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0)

async function airtable(path, init = {}) {
  const res = await fetch(`https://api.airtable.com/v0${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  if (!res.ok) throw new Error(`Airtable ${res.status} on ${path}: ${(await res.text()).slice(0,200)}`)
  return res.json()
}

// ---- Pick the loan ----
const arg = process.argv.find(a => a !== '--dry' && !a.endsWith('.mjs') && !a.startsWith('node') && a !== '--deal')
const dealArg = process.argv[process.argv.indexOf('--deal') + 1]

let loan
if (process.argv.includes('--deal') && dealArg) {
  const { data } = await supa.from('loans').select('*').eq('pipedrive_deal_id', dealArg).single()
  loan = data
} else if (arg) {
  const { data } = await supa.from('loans').select('*').eq('id', arg).single()
  loan = data
} else {
  const { data } = await supa.from('loans').select('*').not('pipedrive_deal_id','is',null).limit(1).single()
  loan = data
}
if (!loan) { console.error('No loan'); process.exit(1) }

console.log(`\n📋 Loan: ${loan.property_address}`)
console.log(`   id=${loan.id}   pipedrive_deal_id=${loan.pipedrive_deal_id}\n`)

const { data: detail } = await supa.from('loan_details').select('*').eq('loan_id', loan.id).maybeSingle()

// ---- Find Airtable Deal ----
const find = await airtable(`/${BASE}/${DEALS}?` + new URLSearchParams({
  filterByFormula: `{Pipedrive Deal ID} = "${loan.pipedrive_deal_id}"`, maxRecords: '1',
}))
if (!find.records?.[0]) { console.log('✗ No matching Airtable row\n'); process.exit(0) }
const dealRec = find.records[0]
const at = dealRec.fields
console.log(`✓ Airtable Deal record: ${dealRec.id}\n`)

// ---- Reconcile each scalar ----
const airtablePatch = {}
const portalLoanPatch = {}
const portalDetailPatch = {}
const decisions = []

for (const [tbl, col, atField, fwdFn, invFn] of MAP) {
  const src = tbl === 'loans' ? loan : (detail ?? {})
  const portal = src[col]
  const airtable = at[atField]
  const pe = isEmpty(portal), ae = isEmpty(airtable)
  if (pe && ae) continue
  if (!pe && !ae) { decisions.push(['SKIP both have values', col, atField, portal, airtable]); continue }
  if (ae && !pe) {
    const v = fwdFn ? fwdFn(portal) : portal
    if (v === undefined) { decisions.push(['SKIP forward-xform rejected', col, atField, portal, null]); continue }
    airtablePatch[atField] = v
    decisions.push(['PUSH portal→AT', col, atField, portal, v])
  } else {
    const v = invFn ? invFn(airtable) : airtable
    if (v === undefined) { decisions.push(['SKIP inverse-xform rejected', col, atField, null, airtable]); continue }
    if (tbl === 'loans') portalLoanPatch[col] = v
    else portalDetailPatch[col] = v
    decisions.push(['PULL AT→portal', col, atField, v, airtable])
  }
}

// ---- Reconcile vendors ----
for (const v of VENDORS) {
  const portalCo = detail?.[v.co]?.trim?.() ?? null
  const portalEm = detail?.[v.em]?.trim?.() ?? null
  const portalPh = detail?.[v.ph]?.trim?.() ?? null
  const linkRaw = at[v.link]
  const linkedIds = Array.isArray(linkRaw) ? linkRaw.filter(x => typeof x === 'string') : []
  if (linkedIds.length === 0 && !portalCo) continue

  if (linkedIds.length > 0) {
    const r = await airtable(`/${BASE}/${v.table}/${linkedIds[0]}`)
    const vf = r.fields
    if (!portalCo && vf.Company) { portalDetailPatch[v.co] = vf.Company; decisions.push(['PULL vendor co→portal', v.co, v.link, vf.Company, null]) }
    if (!portalEm && vf.Email)   { portalDetailPatch[v.em] = vf.Email;   decisions.push(['PULL vendor em→portal', v.em, v.link, vf.Email, null]) }
    if (!portalPh && vf.Phone)   { portalDetailPatch[v.ph] = vf.Phone;   decisions.push(['PULL vendor ph→portal', v.ph, v.link, vf.Phone, null]) }
  } else {
    decisions.push(['(would find/create vendor)', v.co, v.link, portalCo, null])
  }
}

// ---- Report ----
console.log('Reconciliation plan:')
const widthCol = Math.max(...decisions.map(d => d[1].length))
for (const [action, col, atField, portal, airtable] of decisions) {
  const arrow = action.startsWith('PUSH') ? '→' : action.startsWith('PULL') ? '←' : ' '
  console.log(`  ${action.padEnd(28)} ${col.padEnd(widthCol)}  ${arrow}  ${atField}`)
  if (portal != null || airtable != null) {
    const p = JSON.stringify(portal).slice(0,60)
    const a = JSON.stringify(airtable).slice(0,60)
    console.log(`    portal=${p}  airtable=${a}`)
  }
}

console.log(`\nWould PATCH Airtable (${Object.keys(airtablePatch).length} fields):`, Object.keys(airtablePatch).join(', ') || '(none)')
console.log(`Would UPDATE portal loans (${Object.keys(portalLoanPatch).length} cols):`, Object.keys(portalLoanPatch).join(', ') || '(none)')
console.log(`Would UPSERT portal loan_details (${Object.keys(portalDetailPatch).length} cols):`, Object.keys(portalDetailPatch).join(', ') || '(none)')

if (DRY) { console.log('\n[DRY RUN] No writes. Drop --dry to apply.\n'); process.exit(0) }

console.log('\nApplying writes…')
if (Object.keys(airtablePatch).length > 0) {
  await airtable(`/${BASE}/${DEALS}/${dealRec.id}`, { method: 'PATCH', body: JSON.stringify({ fields: airtablePatch, typecast: true }) })
  console.log(`  ✓ Airtable PATCH (${Object.keys(airtablePatch).length} fields)`)
}
if (Object.keys(portalLoanPatch).length > 0) {
  const { error } = await supa.from('loans').update(portalLoanPatch).eq('id', loan.id)
  if (error) console.log('  ✗ portal loans update:', error.message); else console.log(`  ✓ portal loans update (${Object.keys(portalLoanPatch).length} cols)`)
}
if (Object.keys(portalDetailPatch).length > 0) {
  const { error } = await supa.from('loan_details').upsert({ loan_id: loan.id, ...portalDetailPatch, updated_at: new Date().toISOString() }, { onConflict: 'loan_id' })
  if (error) console.log('  ✗ portal loan_details upsert:', error.message); else console.log(`  ✓ portal loan_details upsert (${Object.keys(portalDetailPatch).length} cols)`)
}
console.log(`\n🔗 Verify in Airtable:\n   https://airtable.com/${BASE}/${DEALS}/${dealRec.id}\n`)
