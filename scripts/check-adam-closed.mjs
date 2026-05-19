// One-off verification: show Adam Scovill's closed-in-last-12-months
// matching the same query the dashboard uses.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const { data: lo } = await supa
  .from('loan_officers').select('id, full_name, email').ilike('full_name', '%scovill%').single()
console.log('LO:', lo)

const oneYearAgoIso = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
console.log('Cutoff:', oneYearAgoIso)

const { data: closed } = await supa
  .from('loans')
  .select('id, property_address, loan_amount, closed_at, pipeline_stage, archived')
  .eq('loan_officer_id', lo.id)
  .eq('pipeline_stage', 'Closed')
  .gte('closed_at', oneYearAgoIso)

console.log(`\nClosed (last 12 months) — pipeline_stage='Closed': ${closed.length}`)
const vol = closed.reduce((s, l) => s + (l.loan_amount ?? 0), 0)
console.log(`Volume: $${vol.toLocaleString()}`)
for (const l of closed.sort((a,b) => (a.closed_at ?? '').localeCompare(b.closed_at ?? ''))) {
  console.log(`  ${(l.closed_at ?? '').slice(0,10)}  $${String(l.loan_amount ?? 0).padStart(10)}  ${l.archived ? '[ARCH]' : '      '}  ${l.property_address}`)
}

// Also check: won loans for Adam where stage isn't Closed yet (sync hasn't caught up?)
const { data: wonNotClosed } = await supa
  .from('loans')
  .select('id, property_address, closed_at, pipeline_stage, archived')
  .eq('loan_officer_id', lo.id)
  .gte('closed_at', oneYearAgoIso)
  .neq('pipeline_stage', 'Closed')
console.log(`\nAdam loans with closed_at in last 12mo but pipeline_stage != 'Closed': ${wonNotClosed.length}`)
for (const l of wonNotClosed) {
  console.log(`  ${l.closed_at?.slice(0,10)}  stage=${l.pipeline_stage}  ${l.property_address}`)
}
