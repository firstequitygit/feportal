// Backfill: assign Alicyn DeSimone as underwriter on every CLOSED loan —
// archived or not. Mirrors bulk-assign-underwriter.mjs, which only touched
// active loans in Processing through Submitted.
//
// Why: the "Closed (Last 12 Months)" dashboard tile filters by
// underwriter_id — without this, Alicyn's tile reads 0 for historical
// closings.
//
// Default: dry run. Pass --apply to commit.
//   node scripts/bulk-assign-underwriter-closed.mjs
//   node scripts/bulk-assign-underwriter-closed.mjs --apply
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const APPLY = process.argv.includes('--apply')
const TARGET_NAME = 'DeSimone'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const { data: uws, error: uwErr } = await supa
  .from('underwriters').select('id, full_name, email').ilike('full_name', `%${TARGET_NAME}%`)
if (uwErr) { console.error('underwriter lookup', uwErr); process.exit(1) }
if (!uws?.length) { console.error(`No underwriter matches "${TARGET_NAME}"`); process.exit(1) }
if (uws.length > 1) { console.error('Multiple match:', uws); process.exit(1) }
const uw = uws[0]
console.log(`Underwriter: ${uw.full_name}`)

// Closed loans — archived OR not. Paginate.
const closed = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await supa
    .from('loans')
    .select('id, property_address, closed_at, underwriter_id, archived')
    .eq('pipeline_stage', 'Closed')
    .range(from, from + 999)
  if (error) { console.error('loans fetch', error); process.exit(1) }
  if (!data?.length) break
  closed.push(...data)
  if (data.length < 1000) break
}
console.log(`Closed loans (any archived state): ${closed.length}`)

const counts = { alreadyCorrect: 0, willSet: 0, willOverwrite: 0 }
const updates = []
for (const l of closed) {
  if (l.underwriter_id === uw.id) { counts.alreadyCorrect++; continue }
  if (l.underwriter_id) counts.willOverwrite++
  else counts.willSet++
  updates.push(l)
}
console.log(counts)

if (!APPLY) {
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
