// One-off: null out closed_at on loans whose Pipedrive status is currently
// 'lost' (Pipedrive keeps won_time on a deal that was won and later reopened/
// marked lost, which leaks into the Closings report). Also ensure every
// currently-lost deal is archived in the portal.
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

async function fetchAllByStatus(status) {
  const ids = new Set()
  let start = 0
  while (true) {
    const url = `https://api.pipedrive.com/v1/deals?status=${status}&api_token=${TOKEN}&limit=500&start=${start}`
    const res = await fetch(url); if (!res.ok) throw new Error(`Pipedrive ${res.status}`)
    const j = await res.json()
    const page = j.data || []
    if (page.length === 0) break
    for (const d of page) if (d.pipeline_id === 2) ids.add(d.id)
    const more = j.additional_data?.pagination?.more_items_in_collection
    const next = j.additional_data?.pagination?.next_start
    if (!more || typeof next !== 'number') break
    start = next
  }
  return ids
}

const lostIds = await fetchAllByStatus('lost')
console.log(`Pipedrive lost deals (pipeline 2): ${lostIds.size}`)

// Fetch matching loans in pages (avoid 1000-cap)
const idArray = [...lostIds]
const CHUNK = 200
const lostLoans = []
for (let i = 0; i < idArray.length; i += CHUNK) {
  const slice = idArray.slice(i, i + CHUNK)
  const { data, error } = await supa.from('loans')
    .select('id, pipedrive_deal_id, property_address, archived, closed_at, pipeline_stage')
    .in('pipedrive_deal_id', slice)
  if (error) { console.error(error); process.exit(1) }
  lostLoans.push(...(data ?? []))
}
console.log(`Matched ${lostLoans.length} portal loans`)

const needsClosedAtCleared = lostLoans.filter(l => l.closed_at !== null)
const needsArchiveFlag    = lostLoans.filter(l => !l.archived)
console.log({
  willClearClosedAt: needsClosedAtCleared.length,
  willMarkArchived:  needsArchiveFlag.length,
})

if (needsClosedAtCleared.length > 0) {
  console.log('\nLoans with stale closed_at (first 20):')
  for (const l of needsClosedAtCleared.slice(0, 20)) {
    console.log(`  pd=${l.pipedrive_deal_id}  ${l.pipeline_stage?.padEnd(18)} archived=${l.archived} closed_at=${l.closed_at?.slice(0,10)}  ${l.property_address?.slice(0,50)}`)
  }
}

if (!APPLY) {
  console.log('\n[DRY RUN] Re-run with --apply to commit.')
  process.exit(0)
}

console.log('\nApplying...')
let ok = 0, fail = 0
for (const l of needsClosedAtCleared) {
  const { error } = await supa.from('loans').update({ closed_at: null }).eq('id', l.id)
  if (error) { console.error('FAIL clear closed_at', l.id, error.message); fail++ } else ok++
}
console.log(`closed_at cleared: ${ok}, failed: ${fail}`)

ok = 0; fail = 0
for (const l of needsArchiveFlag) {
  const { error } = await supa.from('loans').update({ archived: true }).eq('id', l.id)
  if (error) { console.error('FAIL mark archived', l.id, error.message); fail++ } else ok++
}
console.log(`archived set: ${ok}, failed: ${fail}`)
