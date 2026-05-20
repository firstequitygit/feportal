// Batch reconcile every portal loan against Airtable (Model B — fill blanks
// only, never overwrite). Standalone node port of src/lib/airtable.ts so we
// can run from CLI without spinning up Next.js. Output is a per-loan progress
// line + a final summary.
//
// Usage:
//   node scripts/airtable-sync-all.mjs           # dry-run, no writes
//   node scripts/airtable-sync-all.mjs --apply   # apply writes

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}
const TOKEN = process.env.AIRTABLE_TOKEN
const BASE  = 'appLaBD8QMTXAF0KJ'
const DEALS = 'tbl0Dg6YE96oD9dDq'
const APPLY = process.argv.includes('--apply')

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

// ---- Transforms (mirror src/lib/airtable-field-map.ts) ----
const fwd = {
  loanType: v => v === 'Fix & Flip (Bridge)' ? 'Bridge' : v === 'Rental (DSCR)' ? 'DSCR' : v === 'New Construction' ? 'New Construction' : undefined,
  termMonths: v => { const n = Number(v); return [12,18,360,480].includes(n) ? `${n} Months` : undefined },
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
  ['loan_details','investor','Investor'],
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
const vendorCache = new Map()

async function airtableApi(path, init = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`https://api.airtable.com/v0${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    })
    if (res.status === 429) { await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt))); continue }
    if (!res.ok) throw new Error(`Airtable ${res.status}: ${(await res.text()).slice(0,150)}`)
    return res.json()
  }
  throw new Error('rate limited too many retries')
}

async function fetchVendor(tableId, recId) {
  const key = `${tableId}::${recId}`
  if (vendorCache.has(key)) return vendorCache.get(key)
  const v = await airtableApi(`/${BASE}/${tableId}/${recId}`)
  vendorCache.set(key, v)
  return v
}

async function findOrCreateVendor(tableId, co, em, ph) {
  const esc = co.replace(/"/g,'\\"').toLowerCase()
  const found = await airtableApi(`/${BASE}/${tableId}?` + new URLSearchParams({
    filterByFormula: `LOWER({Company}) = "${esc}"`, maxRecords: '1',
  }))
  if (found.records?.[0]) {
    const id = found.records[0].id
    const patch = {}
    if (em && isEmpty(found.records[0].fields.Email)) patch.Email = em
    if (ph && isEmpty(found.records[0].fields.Phone)) patch.Phone = ph
    if (Object.keys(patch).length > 0) {
      await airtableApi(`/${BASE}/${tableId}/${id}`, { method: 'PATCH', body: JSON.stringify({ fields: patch }) })
    }
    return id
  }
  const fields = { Company: co }
  if (em) fields.Email = em
  if (ph) fields.Phone = ph
  const created = await airtableApi(`/${BASE}/${tableId}`, { method: 'POST', body: JSON.stringify({ fields }) })
  return created.id
}

// ---- Main: iterate every portal loan with a pipedrive_deal_id ----
const loanIds = []
for (let from = 0; ; from += 1000) {
  const { data } = await supa.from('loans').select('id').not('pipedrive_deal_id','is',null).range(from, from + 999)
  if (!data?.length) break
  for (const l of data) loanIds.push(l.id)
  if (data.length < 1000) break
}
console.log(`Portal loans with pipedrive_deal_id: ${loanIds.length}`)
console.log(APPLY ? 'Mode: APPLY (writes enabled)\n' : 'Mode: DRY RUN (no writes)\n')

const summary = { total: loanIds.length, reconciled: 0, pushed: 0, pulled: 0, noMatch: 0, noDealId: 0, errors: 0 }
let processed = 0

for (const loanId of loanIds) {
  processed++
  try {
    const { data: loan } = await supa.from('loans').select('*').eq('id', loanId).single()
    if (!loan?.pipedrive_deal_id) { summary.noDealId++; continue }

    const find = await airtableApi(`/${BASE}/${DEALS}?` + new URLSearchParams({
      filterByFormula: `{Pipedrive Deal ID} = "${loan.pipedrive_deal_id}"`, maxRecords: '1',
    }))
    if (!find.records?.[0]) { summary.noMatch++; if (processed % 50 === 0) progress(); continue }
    const dealRec = find.records[0]
    const at = dealRec.fields

    const { data: detail } = await supa.from('loan_details').select('*').eq('loan_id', loanId).maybeSingle()

    const airtablePatch = {}, portalLoanPatch = {}, portalDetailPatch = {}

    for (const [tbl, col, atField, fwdFn, invFn] of MAP) {
      const src = tbl === 'loans' ? loan : (detail ?? {})
      const portal = src[col]
      const airtable = at[atField]
      const pe = isEmpty(portal), ae = isEmpty(airtable)
      if (pe === ae) continue
      if (ae && !pe) {
        const v = fwdFn ? fwdFn(portal) : portal
        if (v !== undefined) airtablePatch[atField] = v
      } else {
        const v = invFn ? invFn(airtable) : airtable
        if (v !== undefined) {
          if (tbl === 'loans') portalLoanPatch[col] = v
          else portalDetailPatch[col] = v
        }
      }
    }

    // Vendors
    for (const v of VENDORS) {
      const portalCo = detail?.[v.co]?.trim?.() ?? null
      const portalEm = detail?.[v.em]?.trim?.() ?? null
      const portalPh = detail?.[v.ph]?.trim?.() ?? null
      const linkRaw = at[v.link]
      const linkedIds = Array.isArray(linkRaw) ? linkRaw.filter(x => typeof x === 'string') : []
      if (linkedIds.length === 0 && !portalCo) continue
      if (linkedIds.length > 0) {
        const r = await fetchVendor(v.table, linkedIds[0])
        const vf = r.fields
        if (!portalCo && vf.Company) portalDetailPatch[v.co] = vf.Company
        if (!portalEm && vf.Email)   portalDetailPatch[v.em] = vf.Email
        if (!portalPh && vf.Phone)   portalDetailPatch[v.ph] = vf.Phone
      } else if (APPLY) {
        const id = await findOrCreateVendor(v.table, portalCo, portalEm, portalPh)
        airtablePatch[v.link] = [id]
      }
    }

    const pushed = Object.keys(airtablePatch).length
    const pulled = Object.keys(portalLoanPatch).length + Object.keys(portalDetailPatch).length

    if (APPLY) {
      if (pushed > 0) {
        await airtableApi(`/${BASE}/${DEALS}/${dealRec.id}`, { method: 'PATCH', body: JSON.stringify({ fields: airtablePatch, typecast: true }) })
      }
      if (Object.keys(portalLoanPatch).length > 0) {
        await supa.from('loans').update(portalLoanPatch).eq('id', loanId)
      }
      if (Object.keys(portalDetailPatch).length > 0) {
        await supa.from('loan_details').upsert({ loan_id: loanId, ...portalDetailPatch, updated_at: new Date().toISOString() }, { onConflict: 'loan_id' })
      }
    }

    summary.reconciled++
    summary.pushed += pushed
    summary.pulled += pulled
  } catch (e) {
    summary.errors++
    console.error(`  [error] loan ${loanId}: ${e.message}`)
  }
  if (processed % 50 === 0) progress()
}
progress()

console.log('\n=== Summary ===')
console.log(summary)

function progress() {
  const pct = Math.round(processed / loanIds.length * 100)
  process.stdout.write(`  [${processed}/${loanIds.length} ${pct}%]  reconciled=${summary.reconciled} pushed=${summary.pushed} pulled=${summary.pulled} no-match=${summary.noMatch} errors=${summary.errors}\n`)
}
