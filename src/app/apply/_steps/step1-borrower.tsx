'use client'
import { Lock } from "lucide-react"
import { BORROWER_FIELDS, PRIMARY_EXTRA_FIELDS, type ApplicationData, type FieldDef } from '@/lib/application-fields'
import { FieldRenderer } from '../_components/field-renderer'
import { RepeatingBorrowers } from '../_components/repeating-borrowers'

export function Step1Borrower({ data, set, ensureDraft, missingFields, loanOfficerOptions, primaryExtraFields, brokerInfoFields, readOnlyPrimaryFields }: {
  data: ApplicationData
  set: (patchOrFn: Record<string, unknown> | ((d: ApplicationData) => Record<string, unknown>)) => void
  ensureDraft: (email: string, firstName: string) => void
  missingFields?: string[]
  loanOfficerOptions: string[]
  /** Variant-supplied. Defaults to the shared PRIMARY_EXTRA_FIELDS so existing
   *  borrower callers keep working without change. */
  primaryExtraFields?: FieldDef[]
  /** Optional. When provided (broker variant), renders as its own
   *  prominent "Broker Information" block ABOVE the borrower section so
   *  the broker's own info clearly leads the page. */
  brokerInfoFields?: FieldDef[]
  /** Field names on the primary borrower that should be rendered read-only. */
  readOnlyPrimaryFields?: string[]
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
    // Trigger ensureDraft on either the borrower's email (borrower variant) or
    // the broker's email (broker variant) — whichever the user blurs first.
    // The wizard guards against double-creation via its own `if (token) return`.
    if ((name === 'email' || name === 'broker_email') && typeof value === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value))
      ensureDraft(value, (primary.first_name as string) ?? '')
  }

  const borrowerBlock = (
    <>
      <FieldRenderer
        fields={[...BORROWER_FIELDS, ...(primaryExtraFields ?? PRIMARY_EXTRA_FIELDS)]}
        data={data}
        scope={primary}
        onChange={setPrimary}
        idPrefix="primary."
        missingFields={missingFields}
        optionsOverride={{ loan_officer_assigned: loanOfficerOptions }}
        readOnlyFields={readOnlyPrimaryFields}
      />
      <div className="pt-2">
        <h3 className="mb-4 text-base font-semibold text-gray-900">Co-Borrowers</h3>
        <RepeatingBorrowers
          data={data}
          fields={BORROWER_FIELDS}
          set={set}
          heading="Co-Borrower"
          missingFields={missingFields}
        />
      </div>
    </>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[#1F5D8F]" aria-hidden />
        <div>
          <p className="font-medium text-gray-900">Your information is encrypted</p>
          <p className="text-gray-600 mt-0.5">
            Encrypted in transit and at rest. No credit check runs until you sign the authorization on the Disclosures step.
          </p>
        </div>
      </div>

      {brokerInfoFields && brokerInfoFields.length > 0 ? (
        <>
          <section className="space-y-4">
            <div className="border-l-4 border-[#1F5D8F] pl-3">
              <h2 className="text-lg font-semibold text-gray-900">Broker Information</h2>
              <p className="text-sm text-gray-500">Your details — the broker submitting this application.</p>
            </div>
            <FieldRenderer
              fields={brokerInfoFields}
              data={data}
              scope={primary}
              onChange={setPrimary}
              idPrefix="primary."
              missingFields={missingFields}
            />
          </section>

          <section className="space-y-4 pt-2">
            <div className="border-l-4 border-[#1F5D8F] pl-3">
              <h2 className="text-lg font-semibold text-gray-900">Borrower Information</h2>
              <p className="text-sm text-gray-500">Your client&rsquo;s details — the borrower you&rsquo;re submitting this application for.</p>
            </div>
            {borrowerBlock}
          </section>
        </>
      ) : (
        <div className="space-y-4">{borrowerBlock}</div>
      )}
    </div>
  )
}
