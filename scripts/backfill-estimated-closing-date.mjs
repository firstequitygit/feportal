// One-off: pull the "Closing Date" custom field from every Pipedrive deal in
// pipeline 2 (all statuses) and write to loans.estimated_closing_date.
// This is what the Closings report buckets by — the scheduled close date,
// not the funded date.
//
// Default: dry run. Pass --apply to commit.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const APPLY = process.argv.includes('--apply')
const TOKEN = process.env.PIPEDRIVE_API_TOKEN
const CLOSING_DATE_KEY = 'e150d1a8987dfe88c808d7c2121b9fe02f8a65fe'
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

async function fetchAll(status) {
  const out = []
  let start = 0
  while (true) {
    const r = await fetch(`https://api.pipedrive.com/v1/deals?status=${status}&api_token=${TOKEN}&limit=500&start=${start}`)
    if (!r.ok) throw new Error('Pipedrive ' + r.status)
    const j = await r.json()
    const page = j.data || []
    if (page.length === 0) break
    for (const d of page) {
      if (d.pipeline_id !== 2) continue
      const cd = d[CLOSING_DATE_KEY]
      out.push({ id: d.id, closingDate: typeof cd === 'string' && cd ? cd : null })
    }
    const more = j.additional_data?.pagination?.more_items_in_collection
    const next = j.additional_data?.pagination?.next_start
    if (!more || typeof next !== 'number') break
    start = next
  }
  return out
}

const [open, won, lost] = await Promise.all([fetchAll('open'), fetchAll('won'), fetchAll('lost')])
const all = [...open, ...won, ...lost]
console.log(`Pipedrive pipeline 2 deals: ${all.length} (open ${open.length} / won ${won.length} / lost ${lost.length})`)
const withDate = all.filter(d => d.closingDate)
console.log(`Of those, ${withDate.length} have a Closing Date set`)

// Match to portal loans
const idArray = all.map(d => d.id)
const CHUNK = 200
const loanByDeal = new Map()
for (let i = 0; i < idArray.length; i += CHUNK) {
  const slice = idArray.slice(i, i + CHUNK)
  const { data } = await supa.from('loans').select('id, pipedrive_deal_id, estimated_closing_date').in('pipedrive_deal_id', slice)
  for (const l of data ?? []) loanByDeal.set(l.pipedrive_deal_id, l)
}
console.log(`Matched ${loanByDeal.size} portal loans`)

let willSet = 0, willClear = 0, unchanged = 0, missing = 0
const updates = []
for (const d of all) {
  const loan = loanByDeal.get(d.id)
  if (!loan) { missing++; continue }
  const next = d.closingDate ?? null
  const cur  = loan.estimated_closing_date ?? null
  if (cur === next) { unchanged++; continue }
  if (next && !cur) willSet++
  else if (!next && cur) willClear++
  else willSet++   // change to a different value
  updates.push({ id: loan.id, pd: d.id, next })
}
console.log({ willSet, willClear, unchanged, missingLoanRow: missing, totalUpdates: updates.length })

if (!APPLY) {
  console.log('\n[DRY RUN] Re-run with --apply to commit.')
  process.exit(0)
}

console.log('\nApplying...')
let ok = 0, fail = 0
for (const u of updates) {
  const { error } = await supa.from('loans').update({ estimated_closing_date: u.next }).eq('id', u.id)
  if (error) { console.error('FAIL', u.id, error.message); fail++ } else ok++
}
console.log(`Done. updated=${ok} failed=${fail}`)
