import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}
const TOKEN = process.env.PIPEDRIVE_API_TOKEN
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

// Replicate LO available-to-claim: loan_officer_id is null, not Closed
const { data: raw } = await supa
  .from('loans').select('id, pipedrive_deal_id, property_address, pipeline_stage, archived')
  .is('loan_officer_id', null).neq('pipeline_stage', 'Closed')
console.log(`Raw rows from query: ${raw?.length}`)

// Get archived_loans set in pages (no cap)
const archSet = new Set()
let from = 0
while (true) {
  const { data, error } = await supa.from('archived_loans').select('loan_id').range(from, from + 999)
  if (error) { console.error(error); break }
  if (!data || data.length === 0) break
  for (const r of data) archSet.add(r.loan_id)
  if (data.length < 1000) break
  from += 1000
}
console.log(`archived_loans entries: ${archSet.size}`)

const visible = raw.filter(l => !archSet.has(l.id))
console.log(`LO visible after archived_loans filter: ${visible.length}`)

// Look up each in Pipedrive
console.log('\nChecking Pipedrive status for each...')
const stats = {}
const detail = []
for (const l of visible) {
  const res = await fetch(`https://api.pipedrive.com/v1/deals/${l.pipedrive_deal_id}?api_token=${TOKEN}`)
  const j = await res.json()
  const status = j.data?.status ?? '(missing)'
  stats[status] = (stats[status] ?? 0) + 1
  detail.push({ pd: l.pipedrive_deal_id, stage: l.pipeline_stage, archCol: l.archived, status, addr: l.property_address?.slice(0,55) })
}
console.log('\nBy Pipedrive status:')
for (const [k, v] of Object.entries(stats)) console.log(`  ${v.toString().padStart(4)}  ${k}`)
console.log('\nDetail:')
for (const d of detail) console.log(`  pd=${d.pd}  ${d.stage?.padEnd(18)} archCol=${d.archCol} status=${d.status?.padEnd(6)} ${d.addr}`)
