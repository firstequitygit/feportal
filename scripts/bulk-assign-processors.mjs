// One-off: assign Rebecca Desfosse to loan_processor_id (slot 1) and
// Omayra Cartagena to loan_processor_id_2 (slot 2) on every active loan
// (non-archived, non-closed).
//
// Default: dry run. Pass --apply to commit.
//   node scripts/bulk-assign-processors.mjs
//   node scripts/bulk-assign-processors.mjs --apply
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const APPLY = process.argv.includes('--apply')
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPA_URL || !SUPA_KEY) { console.error('Missing env vars'); process.exit(1) }

const supa = createClient(SUPA_URL, SUPA_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

// --- Resolve processors by full_name (case-insensitive contains)
async function findProcessor(nameFragment) {
  const { data, error } = await supa
    .from('loan_processors').select('id, full_name, email').ilike('full_name', `%${nameFragment}%`)
  if (error) throw error
  if (!data || data.length === 0) throw new Error(`No loan_processors match "${nameFragment}"`)
  if (data.length > 1) {
    console.error(`Multiple matches for "${nameFragment}":`, data); throw new Error('Ambiguous')
  }
  return data[0]
}

const slot1 = await findProcessor('Desfosse')
const slot2 = await findProcessor('Cartagena')
console.log(`Slot 1 → ${slot1.full_name} (${slot1.id})`)
console.log(`Slot 2 → ${slot2.full_name} (${slot2.id})`)

// --- Get archived loan ids to exclude
const { data: archived } = await supa.rpc('get_archived_loan_ids')
const archivedSet = new Set((archived ?? []))

// --- Pull all loans except closed and New Application
const { data: loans, error } = await supa
  .from('loans')
  .select('id, property_address, pipeline_stage, loan_processor_id, loan_processor_id_2')
  .neq('pipeline_stage', 'Closed')
  .neq('pipeline_stage', 'New Application')
if (error) { console.error('loans fetch failed', error); process.exit(1) }

const active = loans.filter(l => !archivedSet.has(l.id))
console.log(`\nActive (non-archived, non-closed) loans: ${active.length}`)

const counts = { alreadyCorrect: 0, willUpdate: 0, willOverwriteSlot1: 0, willOverwriteSlot2: 0 }
const updates = []
for (const l of active) {
  const needsSlot1 = l.loan_processor_id !== slot1.id
  const needsSlot2 = l.loan_processor_id_2 !== slot2.id
  if (!needsSlot1 && !needsSlot2) { counts.alreadyCorrect++; continue }
  if (needsSlot1 && l.loan_processor_id && l.loan_processor_id !== slot1.id) counts.willOverwriteSlot1++
  if (needsSlot2 && l.loan_processor_id_2 && l.loan_processor_id_2 !== slot2.id) counts.willOverwriteSlot2++
  counts.willUpdate++
  updates.push(l)
}
console.log('\n=== Summary ===')
console.log(counts)

if (!APPLY) {
  console.log('\n[DRY RUN] Re-run with --apply to commit.')
  process.exit(0)
}

console.log('\nApplying...')
let ok = 0, fail = 0
for (const l of updates) {
  const { error: upErr } = await supa
    .from('loans')
    .update({ loan_processor_id: slot1.id, loan_processor_id_2: slot2.id })
    .eq('id', l.id)
  if (upErr) { console.error(`FAIL ${l.id}:`, upErr.message); fail++; continue }
  ok++
}
console.log(`Done. updated=${ok} failed=${fail}`)
