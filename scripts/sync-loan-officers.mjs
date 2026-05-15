// One-off: map each open Pipedrive deal's owner to the portal loan_officers row
// (by email) and set loans.loan_officer_id accordingly.
//
// Default: dry run. Pass --apply to actually update rows.
//   node scripts/sync-loan-officers.mjs
//   node scripts/sync-loan-officers.mjs --apply
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const APPLY = process.argv.includes('--apply')
const PIPELINE_ID = 2
const TOKEN = process.env.PIPEDRIVE_API_TOKEN
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!TOKEN || !SUPA_URL || !SUPA_KEY) { console.error('Missing env vars'); process.exit(1) }

const supa = createClient(SUPA_URL, SUPA_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

// --- fetch all open Pipedrive deals (paginated, then filter to pipeline 2)
async function fetchAllOpenDeals() {
  const all = []
  let start = 0
  while (true) {
    const url = `https://api.pipedrive.com/v1/deals?status=open&api_token=${TOKEN}&limit=500&start=${start}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Pipedrive ${res.status}`)
    const json = await res.json()
    const page = json.data || []
    if (page.length === 0) break
    all.push(...page)
    const more = json.additional_data?.pagination?.more_items_in_collection
    const next = json.additional_data?.pagination?.next_start
    if (!more || typeof next !== 'number') break
    start = next
  }
  return all.filter(d => d.pipeline_id === PIPELINE_ID)
}

const deals = await fetchAllOpenDeals()
console.log(`Fetched ${deals.length} open deals in pipeline ${PIPELINE_ID}`)

// --- load portal loan_officers
const { data: officers, error: loErr } = await supa
  .from('loan_officers').select('id, full_name, email')
if (loErr) { console.error('LO fetch failed', loErr); process.exit(1) }
console.log(`Loaded ${officers.length} loan officers from portal`)
const officerByEmail = new Map(officers.map(o => [(o.email ?? '').toLowerCase().trim(), o]))

// --- load portal loans we care about (those matching deal ids)
const dealIds = deals.map(d => d.id)
const { data: loans, error: loanErr } = await supa
  .from('loans')
  .select('id, pipedrive_deal_id, property_address, loan_officer_id')
  .in('pipedrive_deal_id', dealIds)
if (loanErr) { console.error('loans fetch failed', loanErr); process.exit(1) }
console.log(`Found ${loans.length} matching loans in portal`)
const loanByDealId = new Map(loans.map(l => [l.pipedrive_deal_id, l]))

// --- build mapping
const counts = { willUpdate: 0, alreadyCorrect: 0, ownerNoEmail: 0, ownerEmailUnmatched: 0, noLoanRow: 0 }
const unmatchedOwners = new Map() // email -> count
const updates = [] // { loanId, dealId, address, owner, ownerEmail, currentLoId, newLoId }

for (const d of deals) {
  const loan = loanByDealId.get(d.id)
  if (!loan) { counts.noLoanRow++; continue }

  const owner = d.user_id  // Pipedrive owner object: { id, name, email, value }
  const ownerEmail = (owner?.email ?? '').toLowerCase().trim()
  if (!ownerEmail) { counts.ownerNoEmail++; continue }

  const officer = officerByEmail.get(ownerEmail)
  if (!officer) {
    counts.ownerEmailUnmatched++
    unmatchedOwners.set(ownerEmail, (unmatchedOwners.get(ownerEmail) ?? 0) + 1)
    continue
  }

  if (loan.loan_officer_id === officer.id) { counts.alreadyCorrect++; continue }

  counts.willUpdate++
  updates.push({
    loanId: loan.id, dealId: d.id, address: loan.property_address,
    owner: owner.name, ownerEmail, currentLoId: loan.loan_officer_id, newLoId: officer.id,
    officerName: officer.full_name,
  })
}

console.log('\n=== Summary ===')
console.log(counts)
if (unmatchedOwners.size > 0) {
  console.log('\nPipedrive owner emails with no matching portal loan officer:')
  for (const [email, n] of unmatchedOwners) console.log(`  ${email}  (${n} deals)`)
}

if (updates.length > 0) {
  console.log(`\nWould update ${updates.length} loans:`)
  for (const u of updates.slice(0, 20)) {
    console.log(`  ${u.dealId}  ${u.address?.slice(0,40).padEnd(40)}  → ${u.officerName} (${u.ownerEmail})`)
  }
  if (updates.length > 20) console.log(`  ... and ${updates.length - 20} more`)
}

if (!APPLY) {
  console.log('\n[DRY RUN] No changes made. Re-run with --apply to commit.')
  process.exit(0)
}

console.log('\nApplying updates...')
let ok = 0, fail = 0
for (const u of updates) {
  const { error } = await supa.from('loans').update({ loan_officer_id: u.newLoId }).eq('id', u.loanId)
  if (error) { console.error(`FAIL loan ${u.loanId}:`, error.message); fail++ }
  else ok++
}
console.log(`Done. updated=${ok} failed=${fail}`)
