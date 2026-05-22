'use client'
import { UNIT_FIELDS, type ApplicationData } from '@/lib/application-fields'
import { FieldRenderer } from './field-renderer'

function dscrUnitCount(data: ApplicationData): number {
  if (data.loan_type !== 'DSCR Rental Loan') return 0
  const pt = data.property_type
  if (pt === 'Single Family' || pt === 'Condo') return 1
  if (pt === 'Multifamily (2-4 Units)') {
    const n = Number(data.dscr_unit_count)
    return n >= 2 && n <= 4 ? n : 0
  }
  return 0
}

export function RepeatingUnits({ data, set }: {
  data: ApplicationData; set: (patch: Record<string, unknown>) => void
}) {
  const count = dscrUnitCount(data)
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
          <h4 className="mb-2 font-medium">{count === 1 ? 'Rental income' : `Unit ${i + 1}`}</h4>
          <FieldRenderer fields={UNIT_FIELDS} data={data} scope={u} onChange={(n, v) => update(i, n, v)} />
        </div>
      ))}
    </div>
  )
}
