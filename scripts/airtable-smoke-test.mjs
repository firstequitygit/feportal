// Smoke test: pick one portal loan that has a pipedrive_deal_id matching
// an Airtable row, run the sync logic against it, report the result.
// Does NOT use any Next.js/TS — re-implements the bare-minimum path so we
// can verify Airtable accepts our payload before the real cron fires.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const TOKEN = process.env.AIRTABLE_TOKEN
const BASE  = 'appLaBD8QMTXAF0KJ'
const TABLE = 'tbl0Dg6YE96oD9dDq'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

// 1. Find any loan we know has an Airtable match (use Adam's most recent closed loan)
const { data: loans } = await supa
  .from('loans')
  .select('id, pipedrive_deal_id, property_address, loan_number, loan_amount, interest_rate, loan_type, term_months')
  .not('pipedrive_deal_id', 'is', null)
  .eq('pipeline_stage', 'Closed')
  .order('closed_at', { ascending: false })
  .limit(5)

if (!loans?.length) { console.error('No loans found'); process.exit(1) }

console.log('Testing first portal loan that resolves on the Airtable side...\n')

for (const loan of loans) {
  console.log(`> ${loan.property_address}  (deal=${loan.pipedrive_deal_id})`)

  // Find Airtable row by Pipedrive Deal ID
  const url = new URL(`https://api.airtable.com/v0/${BASE}/${TABLE}`)
  url.searchParams.set('filterByFormula', `{Pipedrive Deal ID} = "${loan.pipedrive_deal_id}"`)
  url.searchParams.set('maxRecords', '1')
  const find = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } })
  const found = await find.json()
  if (!found.records?.[0]) { console.log('   no Airtable row, skipping\n'); continue }
  const recordId = found.records[0].id
  console.log(`   Airtable record: ${recordId}`)

  // Build a minimal field payload from the loans-table columns we know exist
  const fields = {}
  if (loan.loan_number)   fields['Loan Number']  = loan.loan_number
  if (loan.loan_amount)   fields['Loan Amount']  = loan.loan_amount
  if (loan.interest_rate) fields['Rate']         = loan.interest_rate

  // loan_type: portal "Fix & Flip (Bridge)" → Airtable "Bridge"
  if (loan.loan_type === 'Fix & Flip (Bridge)') fields['Loan Type'] = 'Bridge'
  else if (loan.loan_type === 'Rental (DSCR)')  fields['Loan Type'] = 'DSCR'
  else if (loan.loan_type === 'New Construction') fields['Loan Type'] = 'New Construction'

  // term_months: 12/18/360/480 → "X Months"
  if ([12, 18, 360, 480].includes(loan.term_months)) {
    fields['Loan Term'] = `${loan.term_months} Months`
  }

  console.log(`   Payload: ${JSON.stringify(fields)}`)

  const patch = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}/${recordId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!patch.ok) {
    const body = await patch.text()
    console.log(`   ✗ FAILED ${patch.status}: ${body.slice(0, 200)}\n`)
  } else {
    console.log(`   ✓ PATCH ok (${Object.keys(fields).length} fields)\n`)
  }
  // Only test the first loan with a matching Airtable row
  process.exit(0)
}
