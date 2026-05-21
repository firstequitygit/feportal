// Backfill: assign Rebecca Desfosse (slot 1) + Omayra Cartagena (slot 2) to
// every CLOSED loan — archived or not. Mirrors bulk-assign-processors.mjs,
// which only touched active (non-closed, non-archived) loans.
//
// Why: the "Closed (Last 12 Months)" dashboard tile filters by
// loan_processor_id / loan_processor_id_2 — without this, every LP's tile
// reads 0 for historical closings.
//
// Default: dry run. Pass --apply to commit.
//   node scripts/bulk-assign-processors-closed.mjs
//   node scripts/bulk-assign-processors-closed.mjs --apply
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const APPLY = process.argv.includes('--apply')
const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

async function findProcessor(nameFragment) {
  const { data, error } = await supa
    .from('loan_processors').select('id, full_name, email').ilike('full_name', `%${nameFragment}%`)
  if (error) throw error
  if (!data?.length) throw new Error(`No loan_processors match "${nameFragment}"`)
  if (data.length > 1) { console.error(`Multiple matches:`, data); throw new Error('Ambiguous') }
  return data[0]
}

const slot1 = await findProcessor('Desfosse')
const slot2 = await findProcessor('Cartagena')
console.log(`Slot 1 → ${slot1.full_name}`)
console.log(`Slot 2 → ${slot2.full_name}`)

// Closed loans — archived OR not. Paginate to dodge the 1000-row cap.
const closed = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await supa
    .from('loans')
    .select('id, property_address, closed_at, loan_processor_id, loan_processor_id_2, archived')
    .eq('pipeline_stage', 'Closed')
    .range(from, from + 999)
  if (error) { console.error('loans fetch failed', error); process.exit(1) }
  if (!data?.length) break
  closed.push(...data)
  if (data.length < 1000) break
}
console.log(`\nClosed loans (any archived state): ${closed.length}`)

const counts = { alreadyCorrect: 0, willUpdate: 0, willOverwriteSlot1: 0, willOverwriteSlot2: 0 }
const updates = []
for (const l of closed) {
  const needs1 = l.loan_processor_id !== slot1.id
  const needs2 = l.loan_processor_id_2 !== slot2.id
  if (!needs1 && !needs2) { counts.alreadyCorrect++; continue }
  if (needs1 && l.loan_processor_id) counts.willOverwriteSlot1++
  if (needs2 && l.loan_processor_id_2) counts.willOverwriteSlot2++
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
  const { error } = await supa
    .from('loans')
    .update({ loan_processor_id: slot1.id, loan_processor_id_2: slot2.id })
    .eq('id', l.id)
  if (error) { console.error(`FAIL ${l.id}:`, error.message); fail++ } else ok++
}
console.log(`Done. updated=${ok} failed=${fail}`)
