import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const { data: dscrLoans } = await s.from('loans')
  .select('id, loan_amount, ltv')
  .eq('loan_type', 'Rental (DSCR)')
  .not('loan_amount','is',null).gt('loan_amount', 0)

const ids = dscrLoans.map(l => l.id)
const detailMap = new Map()
for (let i = 0; i < ids.length; i += 100) {
  const chunk = ids.slice(i, i+100)
  const { data, error } = await s.from('loan_details').select('loan_id, value_as_is').in('loan_id', chunk)
  if (error) { console.error(error); process.exit(1) }
  for (const r of data ?? []) if (r.value_as_is && r.value_as_is > 0) detailMap.set(r.loan_id, r.value_as_is)
}
const eligible = dscrLoans.filter(l => detailMap.has(l.id))
console.log(`DSCR loans with loan_amount: ${dscrLoans.length}`)
console.log(`  also with value_as_is set (eligible for LTV calc): ${eligible.length}`)
console.log('\nSample math (first 6):')
for (const l of eligible.slice(0, 6)) {
  const v = detailMap.get(l.id)
  const calc = Math.round((Number(l.loan_amount) / Number(v)) * 100 * 100) / 100
  console.log(`  amt=$${l.loan_amount.toLocaleString()} / asis=$${v.toLocaleString()} = ${calc}%   (stored ltv=${l.ltv})`)
}
