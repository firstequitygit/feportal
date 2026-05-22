'use client'
import { EXPERIENCE_FIELDS, type ApplicationData } from '@/lib/application-fields'
import { FieldRenderer } from '../_components/field-renderer'

// NOTE: Experience fields are now stored at the root of `data` (e.g., data.flips_last_3y),
// not per-borrower (e.g., data.primary.flips_last_3y). In-flight drafts saved before this
// change will read empty experience values. That is acceptable; borrowers can re-enter.

export function Step3Experience({ data, set, missingFields }: {
  data: ApplicationData
  set: (patch: Record<string, unknown>) => void
  missingFields?: string[]
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="mb-4 text-base font-semibold text-gray-900">Real Estate Experience</h3>
        <p className="mb-4 text-sm text-gray-500">
          Tell us about the combined real estate experience across all borrowers.
        </p>
        <FieldRenderer
          fields={EXPERIENCE_FIELDS}
          data={data}
          scope={data as Record<string, unknown>}
          onChange={(n, v) => set({ [n]: v })}
          idPrefix=""
          missingFields={missingFields}
        />
      </div>
    </div>
  )
}
