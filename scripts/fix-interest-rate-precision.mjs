// One-off: re-pull interest_rate from Airtable into portal for any loan
// where the portal value is clearly a rounded version of the Airtable value.
//
// Why: loans.interest_rate was numeric(5,3) until the 20260520 migration.
// Fraction-form rates like 0.07375 got truncated to 0.074 on insert. Model
// B's "no overwrite" rule would leave these rounded values in place; this
// script identifies them and pulls the precise Airtable value back.
//
// Heuristic: portal and Airtable both have a value, both are < 1 (fraction
// form), and abs(portal - airtable) < 0.001. That's the signature of a
// 3-decimal rounding.
//
// Usage:
//   node scripts/fix-interest-rate-precision.mjs           # dry-run report
//   node scripts/fix-interest-rate-precision.mjs --apply   # apply fixes

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

// 1. Pull all Airtable rows with Pipedrive Deal ID + Rate
const rows = []
let offset
do {
  const url = new URL(`https://api.airtable.com/v0/${BASE}/${DEALS}`)
  url.searchParams.set('fields[]', 'Pipedrive Deal ID')
  url.searchParams.append('fields[]', 'Rate')
  url.searchParams.set('pageSize', '100')
  if (offset) url.searchParams.set('offset', offset)
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } })
  if (!res.ok) { console.error(res.status, await res.text()); process.exit(1) }
  const j = await res.json()
  rows.push(...j.records)
  offset = j.offset
} while (offset)
console.log(`Airtable rows fetched: ${rows.length}`)

const atByDeal = new Map()
for (const r of rows) {
  const id = String(r.fields['Pipedrive Deal ID'] ?? '').trim()
  const rate = Number(r.fields['Rate'])
  if (id && Number.isFinite(rate) && rate > 0) atByDeal.set(id, rate)
}
console.log(`  with Pipedrive Deal ID + Rate: ${atByDeal.size}`)

// 2. Pull portal loans with interest_rate set
const portal = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await supa
    .from('loans').select('id, pipedrive_deal_id, property_address, interest_rate')
    .not('pipedrive_deal_id','is',null)
    .not('interest_rate','is',null)
    .range(from, from + 999)
  if (error) { console.error(error); process.exit(1) }
  if (!data?.length) break
  portal.push(...data)
  if (data.length < 1000) break
}
console.log(`Portal loans with deal id + interest_rate: ${portal.length}\n`)

// 3. Find candidates for precision fix
const candidates = []
for (const l of portal) {
  const at = atByDeal.get(String(l.pipedrive_deal_id))
  if (at === undefined) continue
  const p = Number(l.interest_rate)
  if (!Number.isFinite(p)) continue
  // Both must be in fraction form (< 1) for a fair comparison
  if (p >= 1 || at >= 1) continue
  // Difference suggests rounding (≤ 1 in the 3rd decimal place)
  const diff = Math.abs(p - at)
  if (diff > 0 && diff < 0.001) {
    candidates.push({ loanId: l.id, address: l.property_address, dealId: l.pipedrive_deal_id, portal: p, airtable: at })
  }
}
console.log(`Candidates for fix: ${candidates.length}\n`)

if (candidates.length === 0) {
  console.log('No precision drift detected. Done.')
  process.exit(0)
}

console.log('First 20:')
for (const c of candidates.slice(0, 20)) {
  console.log(`  ${(c.portal * 100).toFixed(3)}% → ${(c.airtable * 100).toFixed(3)}%   ${(c.address ?? '').slice(0, 50)}`)
}
if (candidates.length > 20) console.log(`  ... and ${candidates.length - 20} more`)

if (!APPLY) {
  console.log('\n[DRY RUN] No writes. Re-run with --apply.\n')
  process.exit(0)
}

console.log('\nApplying...')
let ok = 0, fail = 0
for (const c of candidates) {
  const { error } = await supa.from('loans').update({ interest_rate: c.airtable }).eq('id', c.loanId)
  if (error) { console.error(`FAIL ${c.loanId}: ${error.message}`); fail++ }
  else ok++
}
console.log(`Done. updated=${ok} failed=${fail}`)
