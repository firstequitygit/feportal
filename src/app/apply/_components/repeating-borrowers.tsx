'use client'
import { Button } from '@/components/ui/button'
import { MAX_CO_BORROWERS, type FieldDef, type ApplicationData } from '@/lib/application-fields'
import { FieldRenderer } from './field-renderer'

export function RepeatingBorrowers({ data, fields, set, heading }: {
  data: ApplicationData; fields: FieldDef[]; heading: string
  set: (patch: Record<string, unknown>) => void
}) {
  const cobs = Array.isArray(data.co_borrowers) ? (data.co_borrowers as Record<string, unknown>[]) : []
  const update = (i: number, name: string, value: unknown) => {
    const next = cobs.map((c, idx) => idx === i ? { ...c, [name]: value } : c)
    set({ co_borrowers: next })
  }
  return (
    <div className="space-y-6">
      {cobs.map((c, i) => (
        <div key={i} className="rounded-lg border p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-medium">{heading} {i + 1}</h3>
            <Button variant="ghost" size="sm" onClick={() => set({ co_borrowers: cobs.filter((_, idx) => idx !== i) })}>Remove</Button>
          </div>
          <FieldRenderer fields={fields} data={data} scope={c} onChange={(n, v) => update(i, n, v)} />
        </div>
      ))}
      {cobs.length < MAX_CO_BORROWERS && (
        <Button variant="outline" size="sm" onClick={() => set({ co_borrowers: [...cobs, {}] })}>+ Add Co-Borrower</Button>
      )}
    </div>
  )
}
