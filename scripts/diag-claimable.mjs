import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

// 1. count of loans, by stage / archived
const { count: totalLoans } = await supa.from('loans').select('*', { count: 'exact', head: true })
console.log(`Total loans rows: ${totalLoans}`)

const { data: byStage } = await supa.from('loans').select('pipeline_stage')
const stageCounts = {}
for (const l of byStage ?? []) stageCounts[l.pipeline_stage ?? '(null)'] = (stageCounts[l.pipeline_stage ?? '(null)'] ?? 0) + 1
console.log('\nBy pipeline_stage:')
for (const [k, v] of Object.entries(stageCounts).sort((a,b)=>b[1]-a[1])) console.log(`  ${v.toString().padStart(5)}  ${k}`)

const { data: byArchived } = await supa.from('loans').select('archived')
const aCounts = {}
for (const l of byArchived ?? []) aCounts[String(l.archived)] = (aCounts[String(l.archived)] ?? 0) + 1
console.log('\nBy archived column:')
for (const [k, v] of Object.entries(aCounts)) console.log(`  ${v.toString().padStart(5)}  archived=${k}`)

// 2. count archived_loans table directly
const { count: archCount } = await supa.from('archived_loans').select('*', { count: 'exact', head: true })
console.log(`\narchived_loans table count: ${archCount}`)

// 3. fetch get_archived_loan_ids
const { data: archIds } = await supa.rpc('get_archived_loan_ids')
console.log(`get_archived_loan_ids returned: ${(archIds ?? []).length}`)
