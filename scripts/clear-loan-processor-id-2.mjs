// Bulk-clear loans.loan_processor_id_2 across every loan that has it set.
// Slot-2 LP is no longer used per FE policy; slot-1 assignments are
// untouched.
//
//   node scripts/clear-loan-processor-id-2.mjs         # dry run
//   node scripts/clear-loan-processor-id-2.mjs --apply # apply
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
const APPLY = process.argv.includes('--apply')

const { count } = await s.from('loans').select('id', { count: 'exact', head: true }).not('loan_processor_id_2','is',null)
console.log(`Loans with loan_processor_id_2 set: ${count}`)

if (!APPLY) {
  console.log('\n[DRY RUN] Re-run with --apply to clear all slot-2 LP assignments.')
  process.exit(0)
}

const { error, count: updated } = await s
  .from('loans')
  .update({ loan_processor_id_2: null }, { count: 'exact' })
  .not('loan_processor_id_2', 'is', null)
if (error) { console.error('FAIL:', error.message); process.exit(1) }
console.log(`Cleared loan_processor_id_2 on ${updated} loans.`)

// Verify
const { count: remaining } = await s.from('loans').select('id', { count: 'exact', head: true }).not('loan_processor_id_2','is',null)
console.log(`Verification: ${remaining} loans still have it set (should be 0).`)
