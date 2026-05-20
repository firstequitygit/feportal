'use client'
import { Button } from '@/components/ui/button'
import { MAX_CO_BORROWERS, type FieldDef, type ApplicationData } from '@/lib/application-fields'
import { FieldRenderer } from './field-renderer'

export function RepeatingBorrowers({ data, fields, set, heading, missingFields }: {
  data: ApplicationData; fields: FieldDef[]; heading: string
  set: (patch: Record<string, unknown>) => void
  missingFields?: string[]
}) {
  const cobs = Array.isArray(data.co_borrowers) ? (data.co_borrowers as Record<string, unknown>[]) : []
  const update = (i: number, name: string, value: unknown) => {
    const next = cobs.map((c, idx) => idx === i ? { ...c, [name]: value } : c)
    set({ co_borrowers: next })
  }
  return (
    <div className="space-y-8">
      {cobs.map((c, i) => (
        <div key={i}>
          <div className="mb-6 mt-12 flex items-baseline gap-4">
            <span className="text-xs uppercase tracking-[0.22em] text-(--apply-ink-muted)">
              {heading} {i + 1}
            </span>
            <span className="flex-1 border-t border-(--apply-border)" aria-hidden />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => set({ co_borrowers: cobs.filter((_, idx) => idx !== i) })}
              className="text-xs text-(--apply-ink-muted) hover:text-(--apply-danger)"
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
          className="text-xs uppercase tracking-[0.18em] text-(--apply-ink-muted) transition-colors hover:text-(--apply-brand)"
        >
          + Add Co-Borrower
        </button>
      )}
    </div>
  )
}
