// Dump all 315 Deals fields in a clean format — name | type | writable? |
// brief note for select choices / linked tables.
import { readFileSync, writeFileSync } from 'node:fs'
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const TOKEN = process.env.AIRTABLE_TOKEN
const BASE = 'appLaBD8QMTXAF0KJ'
const TABLE_ID = 'tbl0Dg6YE96oD9dDq'

const READ_ONLY = new Set([
  'formula','rollup','count','lookup','multipleLookupValues',
  'createdTime','createdBy','lastModifiedTime','lastModifiedBy',
  'autoNumber','button','externalSyncSource','aiText',
])

const res = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables`, {
  headers: { Authorization: `Bearer ${TOKEN}` },
})
const { tables } = await res.json()
const linkedTableNameById = new Map(tables.map(t => [t.id, t.name]))
const deals = tables.find(t => t.id === TABLE_ID)

const rows = deals.fields.map(f => {
  const writable = !READ_ONLY.has(f.type)
  let note = ''
  if (f.type === 'singleSelect' || f.type === 'multipleSelects') {
    const choices = (f.options?.choices ?? []).map(c => c.name).slice(0, 6)
    note = choices.join(' / ')
    if ((f.options?.choices ?? []).length > 6) note += ` ... (+${f.options.choices.length - 6})`
  } else if (f.type === 'multipleRecordLinks') {
    note = `→ ${linkedTableNameById.get(f.options?.linkedTableId) ?? '?'}`
  } else if (f.type === 'formula') {
    note = `= ${(f.options?.formula ?? '').slice(0, 60).replace(/\s+/g, ' ')}`
  } else if (f.type === 'multipleLookupValues') {
    note = `lookup from linked table`
  }
  return { name: f.name, type: f.type, writable, note }
})

// Sort: writable first (alphabetical), then read-only (alphabetical)
rows.sort((a, b) => {
  if (a.writable !== b.writable) return a.writable ? -1 : 1
  return a.name.localeCompare(b.name)
})

let md = `# Airtable Deals — all 315 fields\n\n`
md += `Base \`appLaBD8QMTXAF0KJ\` · Table \`Deals\` (tbl0Dg6YE96oD9dDq)\n\n`
md += `Use Ctrl-F / Cmd-F to search by portal field name and find the Airtable equivalent.\n\n`
md += `Legend: ✓ = writable, ✗ = read-only (formula / lookup / system).\n\n`
md += `| | Field | Type | Notes |\n|---|---|---|---|\n`
for (const r of rows) {
  const flag = r.writable ? '✓' : '✗'
  md += `| ${flag} | ${r.name} | ${r.type} | ${r.note} |\n`
}
writeFileSync('scripts/airtable-deals-fields.md', md)
console.log(`Wrote scripts/airtable-deals-fields.md (${rows.length} fields, ${rows.filter(r => r.writable).length} writable)`)
