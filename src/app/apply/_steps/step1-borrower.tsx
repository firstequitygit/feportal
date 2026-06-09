'use client'
import { Lock } from "lucide-react"
import { BORROWER_FIELDS, PRIMARY_EXTRA_FIELDS, type ApplicationData, type FieldDef } from '@/lib/application-fields'
import { FieldRenderer } from '../_components/field-renderer'
import { RepeatingBorrowers } from '../_components/repeating-borrowers'

export function Step1Borrower({ data, set, ensureDraft, missingFields, loanOfficerOptions, primaryExtraFields }: {
  data: ApplicationData
  set: (patchOrFn: Record<string, unknown> | ((d: ApplicationData) => Record<string, unknown>)) => void
  ensureDraft: (email: string, firstName: string) => void
  missingFields?: string[]
  loanOfficerOptions: string[]
  /** Variant-supplied. Defaults to the shared PRIMARY_EXTRA_FIELDS so existing
   *  borrower callers keep working without change. */
  primaryExtraFields?: FieldDef[]
}) {
  const primary = (data.primary as Record<string, unknown>) ?? {}
  const setPrimary = (name: string, value: unknown) => {
    // Functional update so sequential calls (e.g. address autocomplete sets
    // street + city + state + zip + lat + lng in a row) all see the latest
    // primary instead of the same closured value.
    set((d) => {
      const cur = (d.primary as Record<string, unknown>) ?? {}
      return { primary: { ...cur, [name]: value } }
    })
    if (name === 'email' && typeof value === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value))
      ensureDraft(value, (primary.first_name as string) ?? '')
  }
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[#1F5D8F]" aria-hidden />
        <div>
          <p className="font-medium text-gray-900">Your information is encrypted</p>
          <p className="text-gray-600 mt-0.5">
            Encrypted in transit and at rest. No credit check runs until you sign the authorization on the Disclosures step.
          </p>
        </div>
      </div>
      <FieldRenderer
        fields={[...BORROWER_FIELDS, ...(primaryExtraFields ?? PRIMARY_EXTRA_FIELDS)]}
        data={data}
        scope={primary}
        onChange={setPrimary}
        idPrefix="primary."
        missingFields={missingFields}
        optionsOverride={{ loan_officer_assigned: loanOfficerOptions }}
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
