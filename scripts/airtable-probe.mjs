// Diagnostic: list bases + tables the AIRTABLE_TOKEN can see, so we can pick
// the right base/table for the Loan Details sync without guessing IDs.
//
//   node scripts/airtable-probe.mjs                  # list bases
//   node scripts/airtable-probe.mjs app123...        # list tables in that base
//   node scripts/airtable-probe.mjs app123... Loans  # dump the schema for one table
import { readFileSync } from 'node:fs'
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const TOKEN = process.env.AIRTABLE_TOKEN
if (!TOKEN) { console.error('AIRTABLE_TOKEN missing from .env.local'); process.exit(1) }

const [, , baseId, tableName] = process.argv

async function api(path) {
  const res = await fetch(`https://api.airtable.com/v0/${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  if (!res.ok) {
    console.error(`Airtable ${res.status} ${res.statusText} on /${path}`)
    console.error(await res.text())
    process.exit(1)
  }
  return res.json()
}

if (!baseId) {
  const { bases } = await api('meta/bases')
  console.log(`Accessible bases: ${bases.length}`)
  for (const b of bases) console.log(`  ${b.id}  ${b.name}  (${b.permissionLevel})`)
  console.log('\nNext: node scripts/airtable-probe.mjs <baseId>')
  process.exit(0)
}

const { tables } = await api(`meta/bases/${baseId}/tables`)

if (!tableName) {
  console.log(`Base ${baseId} contains ${tables.length} tables:`)
  for (const t of tables) console.log(`  ${t.id}  ${t.name}  (${t.fields.length} fields)`)
  console.log('\nNext: node scripts/airtable-probe.mjs', baseId, '"<tableName>"')
  process.exit(0)
}

const t = tables.find(t => t.name === tableName || t.id === tableName)
if (!t) { console.error(`No table named "${tableName}" in base ${baseId}`); process.exit(1) }

console.log(`Table: ${t.name} (${t.id}) — ${t.fields.length} fields\n`)
console.log('Fields:')
for (const f of t.fields) {
  const opts = f.options ? ` options=${JSON.stringify(f.options).slice(0, 60)}` : ''
  console.log(`  ${f.name.padEnd(40)}  ${f.type}${opts}`)
}

// Highlight any field that looks like it might hold a Pipedrive deal id.
const candidates = t.fields.filter(f =>
  /pipedrive|deal\s*id|pd[\s_]?id/i.test(f.name)
)
if (candidates.length > 0) {
  console.log('\nLikely Pipedrive-deal-id column candidates:')
  for (const f of candidates) console.log(`  - ${f.name}  (${f.type})`)
} else {
  console.log('\nNo field name obviously holds a Pipedrive deal ID. You will need to add one.')
}
