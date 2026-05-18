// One-off: bulk-assign an underwriter to every active loan in stages
// Processing through Submitted. Scope mirrors how UW work flows in FE —
// loans aren't UW-relevant until they're past New Application, and Closed
// loans are done.
//
// Default: dry run. Pass --apply to commit.
//   node scripts/bulk-assign-underwriter.mjs
//   node scripts/bulk-assign-underwriter.mjs --apply
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const APPLY = process.argv.includes('--apply')
const TARGET_NAME = 'DeSimone'   // matched case-insensitively by full_name
const STAGES = ['Processing', 'Pre-Underwriting', 'Underwriting', 'Submitted']

const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// 1. Find the underwriter
const { data: uws, error: uwErr } = await supa
  .from('underwriters').select('id, full_name, email').ilike('full_name', `%${TARGET_NAME}%`)
if (uwErr) { console.error('underwriter lookup', uwErr); process.exit(1) }
if (!uws || uws.length === 0) {
  console.error(`No underwriter matches "${TARGET_NAME}"`); process.exit(1)
}
if (uws.length > 1) {
  console.error('Multiple underwriters match:', uws); process.exit(1)
}
const uw = uws[0]
console.log(`Underwriter: ${uw.full_name} (${uw.id})`)

// 2. Pull every active loan in the target stages
const { data: loans, error: loansErr } = await supa
  .from('loans')
  .select('id, property_address, pipeline_stage, underwriter_id')
  .in('pipeline_stage', STAGES)
  .eq('archived', false)
if (loansErr) { console.error('loans fetch', loansErr); process.exit(1) }
console.log(`Active loans in ${STAGES.join(', ')}: ${loans.length}`)

// 3. Diff: what will change
const counts = { alreadyCorrect: 0, willSet: 0, willOverwrite: 0 }
const updates = []
for (const l of loans) {
  if (l.underwriter_id === uw.id) { counts.alreadyCorrect++; continue }
  if (l.underwriter_id) counts.willOverwrite++
  else counts.willSet++
  updates.push(l)
}
console.log(counts)

if (!APPLY) {
  console.log('\nFirst 20 changes:')
  for (const l of updates.slice(0, 20)) {
    console.log(`  ${l.pipeline_stage.padEnd(16)} prevUW=${l.underwriter_id ? 'set' : 'null'}  ${l.property_address?.slice(0, 60)}`)
  }
  if (updates.length > 20) console.log(`  ... and ${updates.length - 20} more`)
  console.log('\n[DRY RUN] Re-run with --apply to commit.')
  process.exit(0)
}

console.log('\nApplying...')
let ok = 0, fail = 0
for (const l of updates) {
  const { error } = await supa.from('loans').update({ underwriter_id: uw.id }).eq('id', l.id)
  if (error) { console.error('FAIL', l.id, error.message); fail++ } else ok++
}
console.log(`Done. updated=${ok} failed=${fail}`)
