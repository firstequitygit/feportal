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
      <div className="mb-6 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <div className="mb-1 flex items-center gap-2 font-medium text-slate-900">
          <Lock className="h-4 w-4 text-slate-600" aria-hidden />
          Your information is encrypted
        </div>
        <p className="text-slate-600">
          We use bank-grade encryption in transit and at rest. We never share
          your data without your authorization, and we don&apos;t run a credit
          check until you sign the authorization on the Disclosures step.
        </p>
      </div>
      <FieldRenderer
        fields={[...BORROWER_FIELDS, ...PRIMARY_EXTRA_FIELDS]}
        data={data}
        scope={primary}
        onChange={setPrimary}
        idPrefix="primary."
        missingFields={missingFields}
      />
      <p className="mt-6 text-center text-xs text-slate-500">
        Your data is encrypted and never shared without your authorization.
      </p>
      <div>
        <h3 className="mb-3 font-medium text-[#1F5D8F]">Co-Borrowers</h3>
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
