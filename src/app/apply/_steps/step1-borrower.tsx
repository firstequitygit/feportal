'use client'
import { Lock } from "lucide-react"
import { BORROWER_FIELDS, PRIMARY_EXTRA_FIELDS, type ApplicationData } from '@/lib/application-fields'
import { FieldRenderer } from '../_components/field-renderer'
import { RepeatingBorrowers } from '../_components/repeating-borrowers'

export function Step1Borrower({ data, set, ensureDraft, missingFields }: {
  data: ApplicationData
  set: (patch: Record<string, unknown>) => void
  ensureDraft: (email: string, firstName: string) => void
  missingFields?: string[]
}) {
  const primary = (data.primary as Record<string, unknown>) ?? {}
  const setPrimary = (name: string, value: unknown) => {
    set({ primary: { ...primary, [name]: value } })
    if (name === 'email' && typeof value === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value))
      ensureDraft(value, (primary.first_name as string) ?? '')
  }
  return (
    <div className="space-y-8">
      <div className="mb-6 flex items-start gap-3 rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[#1F5D8F]" aria-hidden />
        <div>
          <p className="font-medium text-gray-900">Your information is encrypted</p>
          <p className="text-gray-600 mt-0.5">
            Encrypted in transit and at rest. No credit check runs until you sign the authorization on the Disclosures step.
          </p>
        </div>
      </div>
      <FieldRenderer
        fields={[...BORROWER_FIELDS, ...PRIMARY_EXTRA_FIELDS]}
        data={data}
        scope={primary}
        onChange={setPrimary}
        idPrefix="primary."
        missingFields={missingFields}
      />
      <div>
        <h3 className="mb-4 text-base font-semibold text-gray-900">Co-Borrowers</h3>
        <RepeatingBorrowers
          data={data}
          fields={BORROWER_FIELDS}
          set={set}
          heading="Co-Borrower"
          missingFields={missingFields}
        />
      </div>
    </div>
  )
}
