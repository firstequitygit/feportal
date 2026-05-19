// Backfill loans.loan_officer_id for CLOSED/WON Pipedrive deals.
//
// The original sync-loan-officers.mjs only matched status=open deals — so every
// historical closed/won deal has loan_officer_id = null, and the "Closed (Last
// 12 Months)" dashboard tile counts 0 for every LO. This script mirrors that
// logic for status=won deals so each LO's historical closings get attributed.
//
// Default: dry run. Pass --apply to actually update rows.
//   node scripts/sync-loan-officers-closed.mjs
//   node scripts/sync-loan-officers-closed.mjs --apply
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

// --- fetch all WON Pipedrive deals (paginated, then filter to pipeline 2)
async function fetchAllWonDeals() {
  const all = []
  let start = 0
  while (true) {
    const url = `https://api.pipedrive.com/v1/deals?status=won&api_token=${TOKEN}&limit=500&start=${start}`
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

const deals = await fetchAllWonDeals()
console.log(`Fetched ${deals.length} won deals in pipeline ${PIPELINE_ID}`)

// --- load portal loan_officers
const { data: officers, error: loErr } = await supa
  .from('loan_officers').select('id, full_name, email')
if (loErr) { console.error('LO fetch failed', loErr); process.exit(1) }
console.log(`Loaded ${officers.length} loan officers from portal`)
const officerByEmail = new Map(officers.map(o => [(o.email ?? '').toLowerCase().trim(), o]))

// --- load portal loans matching these deal ids (archived OR not — closed loans
//     auto-archive 30 days post-close, so we must NOT filter by archived).
//     Paginate via .range() to dodge PostgREST's 1000-row cap.
const dealIds = deals.map(d => d.id)
const loans = []
const PAGE = 1000
for (let i = 0; i < dealIds.length; i += PAGE) {
  const chunk = dealIds.slice(i, i + PAGE)
  const { data, error } = await supa
    .from('loans')
    .select('id, pipedrive_deal_id, property_address, loan_officer_id, closed_at, pipeline_stage')
    .in('pipedrive_deal_id', chunk)
  if (error) { console.error('loans fetch failed', error); process.exit(1) }
  loans.push(...(data ?? []))
}
console.log(`Found ${loans.length} matching loans in portal (any archived state)`)
const loanByDealId = new Map(loans.map(l => [l.pipedrive_deal_id, l]))

// --- build mapping
const counts = { willUpdate: 0, alreadyCorrect: 0, ownerNoEmail: 0, ownerEmailUnmatched: 0, noLoanRow: 0 }
const unmatchedOwners = new Map() // email -> count
const perOfficer = new Map() // officerName -> count
const updates = []

for (const d of deals) {
  const loan = loanByDealId.get(d.id)
  if (!loan) { counts.noLoanRow++; continue }

  const owner = d.user_id
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
  perOfficer.set(officer.full_name, (perOfficer.get(officer.full_name) ?? 0) + 1)
  updates.push({
    loanId: loan.id, dealId: d.id, address: loan.property_address,
    owner: owner.name, ownerEmail, currentLoId: loan.loan_officer_id, newLoId: officer.id,
    officerName: officer.full_name, closedAt: loan.closed_at,
  })
}

console.log('\n=== Summary ===')
console.log(counts)
if (perOfficer.size > 0) {
  console.log('\nWould attribute to:')
  for (const [name, n] of [...perOfficer.entries()].sort((a,b) => b[1]-a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${name}`)
  }
}
if (unmatchedOwners.size > 0) {
  console.log('\nPipedrive owner emails with no matching portal loan officer:')
  for (const [email, n] of unmatchedOwners) console.log(`  ${email}  (${n} deals)`)
}

if (updates.length > 0) {
  console.log(`\nFirst 20 of ${updates.length} updates:`)
  for (const u of updates.slice(0, 20)) {
    const when = u.closedAt ? u.closedAt.slice(0, 10) : '          '
    console.log(`  ${when}  ${(u.address ?? '').slice(0,40).padEnd(40)}  → ${u.officerName}`)
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
