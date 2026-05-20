// Cross-reference src/app/api/loans/field/route.ts FIELD_WHITELIST against
// the actual DB columns on the loans / loan_details tables, so we know which
// "Loan Details" UI fields can actually be saved (and therefore synced).
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

// Parse FIELD_WHITELIST from the route file
const route = readFileSync('src/app/api/loans/field/route.ts', 'utf8')
const whitelistBlock = route.split('const FIELD_WHITELIST')[1].split('export async')[0]
const fields = []
for (const line of whitelistBlock.split('\n')) {
  const m = line.match(/^\s+([a-z_]+):\s*\{[^}]*\}/)
  if (m) {
    const name = m[1]
    const tableMatch = line.match(/table:\s*'(loans|loan_details)'/)
    const table = tableMatch?.[1] ?? 'loans'
    fields.push({ name, table })
  }
}
console.log(`API whitelist: ${fields.length} fields`)

// Get loans columns by selecting a row
const { data: loansSample } = await s.from('loans').select('*').limit(1)
const loansCols = loansSample?.[0] ? new Set(Object.keys(loansSample[0])) : new Set()

// Get loan_details columns by probing each whitelist field (since table has 0 rows)
const detailsCols = new Set()
for (const f of fields.filter(f => f.table === 'loan_details')) {
  const { error } = await s.from('loan_details').select(f.name).limit(1)
  if (!error) detailsCols.add(f.name)
}

const missing = fields.filter(f =>
  f.table === 'loans' ? !loansCols.has(f.name) : !detailsCols.has(f.name)
)
const ok = fields.length - missing.length

console.log(`\nBacked by DB column:   ${ok}`)
console.log(`MISSING column in DB:  ${missing.length}\n`)

if (missing.length > 0) {
  console.log('Fields in the API whitelist but NOT in the DB (saving them would error):')
  for (const f of missing) console.log(`  ${f.table.padEnd(13)} ${f.name}`)
}
