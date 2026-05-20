// Diagnostic: how many Airtable Deals rows have Pipedrive Deal ID populated,
// and what fraction of portal loans we can match.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const TOKEN = process.env.AIRTABLE_TOKEN
const BASE = 'appLaBD8QMTXAF0KJ'
const TABLE = 'tbl0Dg6YE96oD9dDq'
const FIELD = 'Pipedrive Deal ID'

// 1. Fetch ALL Airtable rows (just Loan Number + Pipedrive Deal ID columns)
let offset
const rows = []
do {
  const url = new URL(`https://api.airtable.com/v0/${BASE}/${TABLE}`)
  url.searchParams.set('fields[]', FIELD)
  url.searchParams.append('fields[]', 'Loan Number')
  url.searchParams.set('pageSize', '100')
  if (offset) url.searchParams.set('offset', offset)
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } })
  if (!res.ok) { console.error(res.status, await res.text()); process.exit(1) }
  const json = await res.json()
  rows.push(...json.records)
  offset = json.offset
} while (offset)

console.log(`Airtable Deals rows: ${rows.length}`)
const populated = rows.filter(r => r.fields[FIELD]).length
console.log(`  with "Pipedrive Deal ID" populated: ${populated}`)
console.log(`  empty: ${rows.length - populated}`)

const airtableIds = new Set(
  rows.map(r => String(r.fields[FIELD] ?? '').trim()).filter(Boolean)
)
console.log(`  unique deal ids: ${airtableIds.size}`)

// Sample a few
console.log('\nSample populated values:')
for (const r of rows.filter(r => r.fields[FIELD]).slice(0, 5)) {
  console.log(`  ${JSON.stringify(r.fields[FIELD])}  (Loan #${r.fields['Loan Number'] ?? '—'})`)
}

// 2. Compare against portal loans
const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)
const portalIds = new Set()
for (let from = 0; ; from += 1000) {
  const { data, error } = await supa
    .from('loans').select('pipedrive_deal_id').range(from, from + 999)
  if (error) { console.error(error); process.exit(1) }
  if (!data?.length) break
  for (const l of data) if (l.pipedrive_deal_id) portalIds.add(String(l.pipedrive_deal_id).trim())
  if (data.length < 1000) break
}
console.log(`\nPortal loans with pipedrive_deal_id: ${portalIds.size}`)

const intersection = [...portalIds].filter(id => airtableIds.has(id))
const portalOnly    = [...portalIds].filter(id => !airtableIds.has(id))
const airtableOnly  = [...airtableIds].filter(id => !portalIds.has(id))
console.log(`Matched (in both):     ${intersection.length}`)
console.log(`Portal only (no Airtable row): ${portalOnly.length}`)
console.log(`Airtable only (no portal row): ${airtableOnly.length}`)
