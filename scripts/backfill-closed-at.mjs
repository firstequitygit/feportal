// One-off: backfill loans.closed_at from Pipedrive's won_time for every
// deal that's currently won (i.e. fully closed in Pipedrive). Lost deals
// also have a close_time, but those aren't "closings" — skip them.
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

// Fetch every won deal in pipeline 2 (paginated)
async function fetchWonDeals() {
  const all = []
  let start = 0
  while (true) {
    const url = `https://api.pipedrive.com/v1/deals?status=won&api_token=${TOKEN}&limit=500&start=${start}`
    const res = await fetch(url); if (!res.ok) throw new Error(`Pipedrive ${res.status}`)
    const j = await res.json()
    const page = j.data || []
    if (page.length === 0) break
    for (const d of page) {
      if (d.pipeline_id !== 2) continue
      if (!d.won_time) continue
      all.push({ id: d.id, won_time: d.won_time })
    }
    const more = j.additional_data?.pagination?.more_items_in_collection
    const next = j.additional_data?.pagination?.next_start
    if (!more || typeof next !== 'number') break
    start = next
  }
  return all
}

const won = await fetchWonDeals()
console.log(`Won deals fetched (pipeline 2): ${won.length}`)

// Fetch matching loans in pages to avoid the 1000-row cap
const idArray = won.map(d => d.id)
const CHUNK = 200
const loanByDeal = new Map()
for (let i = 0; i < idArray.length; i += CHUNK) {
  const slice = idArray.slice(i, i + CHUNK)
  const { data } = await supa.from('loans')
    .select('id, pipedrive_deal_id, closed_at, property_address')
    .in('pipedrive_deal_id', slice)
  for (const l of data ?? []) loanByDeal.set(l.pipedrive_deal_id, l)
}
console.log(`Matched ${loanByDeal.size} portal loans`)

// Diff
const updates = []
let alreadyCorrect = 0, missing = 0
for (const d of won) {
  const loan = loanByDeal.get(d.id)
  if (!loan) { missing++; continue }
  // Normalize Pipedrive's "YYYY-MM-DD HH:MM:SS" UTC to ISO
  const iso = new Date(d.won_time.replace(' ', 'T') + 'Z').toISOString()
  if (loan.closed_at === iso) { alreadyCorrect++; continue }
  updates.push({ id: loan.id, dealId: d.id, addr: loan.property_address, current: loan.closed_at, next: iso })
}
console.log({ willUpdate: updates.length, alreadyCorrect, missingLoanRow: missing })

if (updates.length > 0) {
  console.log('\nFirst 10:')
  for (const u of updates.slice(0,10)) console.log('  pd=' + u.dealId, u.next.slice(0,10), u.addr?.slice(0,50))
}

if (!APPLY) {
  console.log('\n[DRY RUN] Re-run with --apply to commit.')
  process.exit(0)
}

console.log('\nApplying...')
let ok = 0, fail = 0
for (const u of updates) {
  const { error } = await supa.from('loans').update({ closed_at: u.next }).eq('id', u.id)
  if (error) { console.error('FAIL', u.id, error.message); fail++ } else ok++
}
console.log(`Done. updated=${ok} failed=${fail}`)
