'use client'
import { DECLARATION_FIELDS, HMDA_FIELDS, type ApplicationData } from "@/lib/application-fields"
import { FieldRenderer } from "../_components/field-renderer"

// Declaration and HMDA fields are stored at the root of `data` (e.g., data.d_liens,
// data.hmda_ethnicity). Production phrases declarations as "you (borrower or co-borrower)"
// One set applies to the whole application. HMDA is for the primary borrower only.

export function Step4Declarations({ data, set, missingFields }: {
  data: ApplicationData
  set: (patch: Record<string, unknown>) => void
  missingFields?: string[]
}) {
  return (
    <div className="space-y-8">
      <section>
        <h3 className="mb-4 text-base font-semibold text-gray-900">Declarations</h3>
        <p className="mb-4 text-sm text-gray-500">
          These questions apply to you and all co-borrowers on this application.
        </p>
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <FieldRenderer
            fields={DECLARATION_FIELDS}
            data={data}
            scope={data as Record<string, unknown>}
            onChange={(n, v) => set({ [n]: v })}
            idPrefix=""
            missingFields={missingFields}
          />
        </div>
        <div className="mt-4 space-y-1.5">
          <label className="text-sm font-medium text-gray-700">
            If you answered yes to any of the above declarations, please explain
          </label>
          <textarea
            id="f-declarations_explanation"
            className="flex min-h-24 w-full rounded-md border border-gray-300 bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-[#1F5D8F] focus:ring-1 focus:ring-[#1F5D8F]/30"
            value={(data.declarations_explanation as string) ?? ''}
            onChange={e => set({ declarations_explanation: e.target.value })}
          />
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-base font-semibold text-gray-900">Government monitoring (HMDA)</h3>
        <p className="mb-6 text-sm text-gray-500 leading-relaxed">
          The following questions are required by federal law (Home Mortgage Disclosure Act) for
          fair-lending reporting. They do not affect your application. You may choose
          &ldquo;I do not wish to provide this information.&rdquo;
        </p>
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <FieldRenderer
            fields={HMDA_FIELDS}
            data={data}
            scope={data as Record<string, unknown>}
            onChange={(n, v) => set({ [n]: v })}
            idPrefix=""
            missingFields={missingFields}
          />
        </div>
      </section>
    </div>
  )
}
