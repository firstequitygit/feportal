'use client'
import { Button } from '@/components/ui/button'
import { MAX_CO_BORROWERS, type FieldDef, type ApplicationData } from '@/lib/application-fields'
import { FieldRenderer } from './field-renderer'

export function RepeatingBorrowers({ data, fields, set, heading, missingFields }: {
  data: ApplicationData; fields: FieldDef[]; heading: string
  set: (patchOrFn: Record<string, unknown> | ((d: ApplicationData) => Record<string, unknown>)) => void
  missingFields?: string[]
}) {
  const cobs = Array.isArray(data.co_borrowers) ? (data.co_borrowers as Record<string, unknown>[]) : []
  const update = (i: number, name: string, value: unknown) => {
    // Functional update so multiple field updates (autocomplete) compound.
    set((d) => {
      const arr = Array.isArray(d.co_borrowers) ? (d.co_borrowers as Record<string, unknown>[]) : []
      const next = arr.map((c, idx) => idx === i ? { ...c, [name]: value } : c)
      return { co_borrowers: next }
    })
  }
  return (
    <div className="space-y-5">
      {cobs.map((c, i) => (
        <div key={i} className="rounded-lg border border-gray-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-900">
              {heading} {i + 1}
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => set({ co_borrowers: cobs.filter((_, idx) => idx !== i) })}
              className="text-xs text-gray-500 hover:text-red-600"
            >
              Remove
            </Button>
          </div>
          <FieldRenderer
            fields={fields}
            data={data}
            scope={c}
            onChange={(n, v) => update(i, n, v)}
            idPrefix={`coborrower${i + 1}.`}
            missingFields={missingFields}
          />
        </div>
      ))}
      {cobs.length < MAX_CO_BORROWERS && (
        <button
          type="button"
          onClick={() => set({ co_borrowers: [...cobs, {}] })}
          className="text-sm text-[#1F5D8F] underline hover:text-[#0F3A5E]"
        >
          + Add Co-Borrower
        </button>
      )}
    </div>
  )
}
