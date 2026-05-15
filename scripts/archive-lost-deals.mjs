// Identify portal loans whose Pipedrive deal is "lost" but which are not
// archived in the portal, and archive them.
//
// Default: dry run. Pass --apply to commit.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const APPLY = process.argv.includes('--apply')
const TOKEN = process.env.PIPEDRIVE_API_TOKEN
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

async function fetchLostDealIds() {
  const ids = new Set()
  let start = 0
  while (true) {
    const url = `https://api.pipedrive.com/v1/deals?status=lost&api_token=${TOKEN}&limit=500&start=${start}`
    const res = await fetch(url); if (!res.ok) throw new Error(`Pipedrive ${res.status}`)
    const json = await res.json()
    const page = json.data || []
    if (page.length === 0) break
    for (const d of page) if (d.pipeline_id === 2) ids.add(d.id)
    const more = json.additional_data?.pagination?.more_items_in_collection
    const next = json.additional_data?.pagination?.next_start
    if (!more || typeof next !== 'number') break
    start = next
  }
  return ids
}

const lostIds = await fetchLostDealIds()
console.log(`Pipedrive lost deals (pipeline 2): ${lostIds.size}`)

// Fetch all loans matching those deal ids in pages (avoid 1000-row cap)
const allLost = []
const idArray = [...lostIds]
const CHUNK = 200
for (let i = 0; i < idArray.length; i += CHUNK) {
  const slice = idArray.slice(i, i + CHUNK)
  const { data, error } = await supa
    .from('loans')
    .select('id, pipedrive_deal_id, property_address, archived, pipeline_stage, loan_officer_id')
    .in('pipedrive_deal_id', slice)
  if (error) { console.error(error); process.exit(1) }
  allLost.push(...(data ?? []))
}
console.log(`Matched ${allLost.length} loan rows in portal`)

// Filter to those not yet archived
const notYet = allLost.filter(l => !l.archived)
console.log(`Not yet archived: ${notYet.length}`)

// Also check archived_loans table for these specific ids (in case archived column lies)
const { data: existingArchive } = await supa
  .from('archived_loans').select('loan_id').in('loan_id', notYet.map(l => l.id))
const alreadyArchived = new Set((existingArchive ?? []).map(r => r.loan_id))
const toArchive = notYet.filter(l => !alreadyArchived.has(l.id))
console.log(`Need archived_loans row: ${toArchive.length}`)

if (toArchive.length > 0) {
  console.log('\nFirst 20:')
  for (const l of toArchive.slice(0, 20)) {
    console.log(`  pd=${l.pipedrive_deal_id}  ${l.pipeline_stage?.padEnd(18)} loId=${l.loan_officer_id?'set':'null'}  ${l.property_address?.slice(0,50)}`)
  }
  if (toArchive.length > 20) console.log(`  ... and ${toArchive.length - 20} more`)
}

if (!APPLY) {
  console.log('\n[DRY RUN] Re-run with --apply to commit.')
  process.exit(0)
}

console.log('\nApplying...')
let ok = 0, fail = 0
for (const l of toArchive) {
  // set_loan_archived flips loans.archived=true AND inserts archived_loans row
  const { error } = await supa.rpc('set_loan_archived', { p_loan_id: l.id, p_archived: true })
  if (error) { console.error(`FAIL ${l.id}:`, error.message); fail++ } else ok++
}
// Also set the column directly for any that were already in archived_loans but had column=false
const colFlipIds = notYet.filter(l => alreadyArchived.has(l.id)).map(l => l.id)
if (colFlipIds.length > 0) {
  const { error } = await supa.from('loans').update({ archived: true }).in('id', colFlipIds)
  if (error) console.error('Column flip failed:', error.message)
  else console.log(`Reconciled archived=true on ${colFlipIds.length} rows that already had an archived_loans entry`)
}
console.log(`Done. archived=${ok} failed=${fail}`)
