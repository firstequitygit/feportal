'use client'
import { UNIT_FIELDS, type ApplicationData } from '@/lib/application-fields'
import { FieldRenderer } from './field-renderer'

export function RepeatingUnits({ data, set }: {
  data: ApplicationData; set: (patch: Record<string, unknown>) => void
}) {
  const count = Math.max(0, Math.min(4, Number(data.number_of_units) || 0))
  if (!count) return null
  const units = Array.isArray(data.units) ? (data.units as Record<string, unknown>[]) : []
  const rows = Array.from({ length: count }, (_, i) => units[i] ?? {})
  const update = (i: number, name: string, value: unknown) => {
    const next = rows.map((u, idx) => idx === i ? { ...u, [name]: value } : u)
    set({ units: next })
  }
  return (
    <div className="space-y-4">
      {Number(data.number_of_units) > 4 && (
        <p className="text-xs text-amber-600">
          For properties with 5+ units, enter the 4 largest units here. Provide details for remaining units in the rent-roll document.
        </p>
      )}
      {rows.map((u, i) => (
        <div key={i} className="rounded-lg border p-4">
          <h4 className="mb-2 font-medium">Unit {i + 1}</h4>
          <FieldRenderer fields={UNIT_FIELDS} data={data} scope={u} onChange={(n, v) => update(i, n, v)} />
        </div>
      ))}
    </div>
  )
}
