'use client'
import { EXPERIENCE_FIELDS, type ApplicationData } from '@/lib/application-fields'
import { FieldRenderer } from '../_components/field-renderer'

export function Step3Experience({ data, set, missingFields }: {
  data: ApplicationData
  set: (patch: Record<string, unknown>) => void
  missingFields?: string[]
}) {
  const primary = (data.primary as Record<string, unknown>) ?? {}
  const cobs = Array.isArray(data.co_borrowers) ? (data.co_borrowers as Record<string, unknown>[]) : []
  return (
    <div className="space-y-8">
      <div>
        <div className="mb-6 flex items-baseline gap-4">
          <span className="text-xs uppercase tracking-[0.22em] text-(--apply-ink-muted)">Primary Borrower</span>
          <span className="flex-1 border-t border-(--apply-border)" aria-hidden />
        </div>
        <FieldRenderer
          fields={EXPERIENCE_FIELDS}
          data={data}
          scope={primary}
          onChange={(n, v) => set({ primary: { ...primary, [n]: v } })}
          idPrefix="primary."
          missingFields={missingFields}
        />
      </div>
      {cobs.map((c, i) => (
        <div key={i}>
          <div className="mb-6 mt-12 flex items-baseline gap-4">
            <span className="text-xs uppercase tracking-[0.22em] text-(--apply-ink-muted)">
              Borrower {i + 2}
            </span>
            <span className="flex-1 border-t border-(--apply-border)" aria-hidden />
          </div>
          <FieldRenderer
            fields={EXPERIENCE_FIELDS}
            data={data}
            scope={c}
            onChange={(n, v) => set({ co_borrowers: cobs.map((x, idx) => idx === i ? { ...x, [n]: v } : x) })}
            idPrefix={`coborrower${i + 1}.`}
            missingFields={missingFields}
          />
        </div>
      ))}
    </div>
  )
}
