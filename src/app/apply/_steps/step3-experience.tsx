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
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="mb-4 text-base font-semibold text-gray-900">Primary Borrower</h3>
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
        <div key={i} className="rounded-lg border border-gray-200 bg-white p-6">
          <h3 className="mb-4 text-base font-semibold text-gray-900">Co-Borrower {i + 1}</h3>
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
