// One-off: walk every Pipedrive deal in pipeline 2 and create/link the
// portal borrower row from the Person on the deal, then set loans.borrower_id.
// Mirrors the logic in lib/borrower-sync.ts so we don't need to deploy
// the sync route before backfilling.
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

async function fetchAllDeals() {
  const all = []
  for (const status of ['open', 'won', 'lost']) {
    let start = 0
    while (true) {
      const r = await fetch(`https://api.pipedrive.com/v1/deals?status=${status}&api_token=${TOKEN}&limit=500&start=${start}`)
      if (!r.ok) throw new Error('Pipedrive ' + r.status)
      const j = await r.json()
      const page = j.data || []
      if (page.length === 0) break
      for (const d of page) if (d.pipeline_id === 2) all.push(d)
      const more = j.additional_data?.pagination?.more_items_in_collection
      const next = j.additional_data?.pagination?.next_start
      if (!more || typeof next !== 'number') break
      start = next
    }
  }
  return all
}

function pickPrimary(arr) {
  if (!arr || arr.length === 0) return null
  const primary = arr.find(e => e.primary)
  return (primary?.value ?? arr[0]?.value ?? null) || null
}

async function findOrLinkBorrower(person) {
  if (!person.email) return { id: null, action: 'skip-no-email' }

  const byPersonId = await supa.from('borrowers')
    .select('id, auth_user_id, email').eq('pipedrive_person_id', person.pipedrive_person_id).maybeSingle()
  if (byPersonId.data) {
    const updates = { full_name: person.full_name, phone: person.phone }
    if (!byPersonId.data.auth_user_id && person.email !== byPersonId.data.email) updates.email = person.email
    if (APPLY) await supa.from('borrowers').update(updates).eq('id', byPersonId.data.id)
    return { id: byPersonId.data.id, action: 'matched-by-person-id' }
  }

  const byEmail = await supa.from('borrowers').select('id').eq('email', person.email).maybeSingle()
  if (byEmail.data) {
    if (APPLY) {
      await supa.from('borrowers').update({
        pipedrive_person_id: person.pipedrive_person_id, full_name: person.full_name, phone: person.phone
      }).eq('id', byEmail.data.id)
    }
    return { id: byEmail.data.id, action: 'matched-by-email' }
  }

  if (!APPLY) return { id: 'NEW', action: 'would-create' }
  const { data: created, error } = await supa.from('borrowers').insert({
    pipedrive_person_id: person.pipedrive_person_id,
    email: person.email,
    full_name: person.full_name,
    phone: person.phone,
  }).select('id').single()
  if (error) { console.error('create error:', error.message, 'email:', person.email); return { id: null, action: 'create-failed:' + error.message } }
  return { id: created.id, action: 'created' }
}

const deals = await fetchAllDeals()
console.log(`Pipedrive deals (pipeline 2): ${deals.length}`)

const tally = { matchedByPersonId: 0, matchedByEmail: 0, created: 0, skippedNoPerson: 0, skippedNoEmail: 0, loansLinked: 0, loansSkipped: 0 }

for (const d of deals) {
  if (!d.person_id?.value) { tally.skippedNoPerson++; continue }
  const person = {
    pipedrive_person_id: d.person_id.value,
    full_name: d.person_id.name ?? null,
    email: pickPrimary(d.person_id.email),
    phone: pickPrimary(d.person_id.phone),
  }
  const { id, action } = await findOrLinkBorrower(person)
  if (action === 'skip-no-email') tally.skippedNoEmail++
  else if (action === 'matched-by-person-id') tally.matchedByPersonId++
  else if (action === 'matched-by-email') tally.matchedByEmail++
  else if (action === 'created' || action === 'would-create') tally.created++

  if (!id || id === 'NEW') {
    if (action !== 'would-create') tally.loansSkipped++
    else tally.loansLinked++
    continue
  }
  if (APPLY) {
    const { error } = await supa.from('loans').update({ borrower_id: id }).eq('pipedrive_deal_id', d.id)
    if (error) { console.error('loan link error pd=' + d.id, error.message); tally.loansSkipped++ }
    else tally.loansLinked++
  } else {
    tally.loansLinked++
  }
}

console.log('\nResult:', tally)
if (!APPLY) console.log('\n[DRY RUN] Re-run with --apply to commit.')
