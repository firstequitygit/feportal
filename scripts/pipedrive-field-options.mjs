// Discover the option IDs for Pipedrive's "Interest Only" and "Locked?"
// custom fields so the portal can write back to them when an admin edits.
import { readFileSync } from 'node:fs'
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}
const TOKEN = process.env.PIPEDRIVE_API_TOKEN
if (!TOKEN) { console.error('PIPEDRIVE_API_TOKEN missing'); process.exit(1) }

const TARGETS = {
  rateLocked:   '95ffccc8689ae55b3bf20382cb71f0c85a5f5680', // "Locked?"
  interestOnly: 'f0b4e7a479c1aa69c7d39b8a19925fd154920fc3', // "Interest Only"
}

// Pull all deal fields (paginated) and find the two we care about
async function fetchAll() {
  const all = []
  let start = 0
  while (true) {
    const res = await fetch(`https://api.pipedrive.com/v1/dealFields?api_token=${TOKEN}&start=${start}&limit=100`)
    if (!res.ok) { console.error('Pipedrive', res.status); process.exit(1) }
    const json = await res.json()
    const page = json.data ?? []
    if (page.length === 0) break
    all.push(...page)
    const more = json.additional_data?.pagination?.more_items_in_collection
    const next = json.additional_data?.pagination?.next_start
    if (!more || typeof next !== 'number') break
    start = next
  }
  return all
}

const fields = await fetchAll()
for (const [label, key] of Object.entries(TARGETS)) {
  const f = fields.find(x => x.key === key)
  if (!f) { console.log(`\n${label} (${key}): NOT FOUND in Pipedrive`); continue }
  console.log(`\n${label} (key=${key})`)
  console.log(`  Pipedrive name: "${f.name}"`)
  console.log(`  field_type:     ${f.field_type}`)
  if (Array.isArray(f.options)) {
    console.log(`  Options:`)
    for (const o of f.options) console.log(`    id=${o.id}  label="${o.label}"`)
  } else {
    console.log(`  (no enum options)`)
  }
}
