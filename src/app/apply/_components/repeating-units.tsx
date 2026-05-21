'use client'
import { UNIT_FIELDS, type ApplicationData } from '@/lib/application-fields'
import { FieldRenderer } from './field-renderer'

function unitCountFromPropertyType(pt: unknown, numberOfUnits: unknown): number {
  if (pt === 'Multifamily (2 Units)') return 2
  if (pt === 'Multifamily (3 Units)') return 3
  if (pt === 'Multifamily (4 Units)') return 4
  if (pt === 'Multifamily (2-4 Units)') return Math.max(0, Math.min(4, Number(numberOfUnits) || 0))
  return 0
}

export function RepeatingUnits({ data, set }: {
  data: ApplicationData; set: (patch: Record<string, unknown>) => void
}) {
  // Render per-unit detail for DSCR individual counts (2/3/4 Units) and
  // for grouped 2-4 Units (Fix & Flip) where unit count comes from number_of_units.
  // 5+ units use total_monthly_rents on the deal step instead.
  const count = unitCountFromPropertyType(data.property_type, data.number_of_units)
  if (!count) return null

  const units = Array.isArray(data.units) ? (data.units as Record<string, unknown>[]) : []
  const rows = Array.from({ length: count }, (_, i) => units[i] ?? {})
  const update = (i: number, name: string, value: unknown) => {
    const next = rows.map((u, idx) => idx === i ? { ...u, [name]: value } : u)
    set({ units: next })
  }
  return (
    <div className="space-y-4">
      {rows.map((u, i) => (
        <div key={i} className="rounded-lg border p-4">
          <h4 className="mb-2 font-medium">Unit {i + 1}</h4>
          <FieldRenderer fields={UNIT_FIELDS} data={data} scope={u} onChange={(n, v) => update(i, n, v)} />
        </div>
      ))}
    </div>
  )
}
