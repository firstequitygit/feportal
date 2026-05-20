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
      <div className="mb-10 grid grid-cols-[auto_1fr] gap-4 border-y border-(--apply-border) py-6">
        <div className="rounded-full bg-(--apply-brand-tint) p-2.5">
          <Lock className="h-4 w-4 text-(--apply-brand)" aria-hidden />
        </div>
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-(--apply-ink-muted) mb-1">
            Encryption &amp; privacy
          </div>
          <p className="text-sm text-(--apply-ink-subtle) leading-relaxed">
            Your information is encrypted in transit and at rest. No credit check
            runs until you sign the authorization on the Disclosures step.
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
      <p className="mt-6 text-center text-xs uppercase tracking-[0.18em] text-(--apply-ink-muted)">
        Secured · encrypted · never shared without your authorization
      </p>
      <div>
        <div className="mb-6 mt-4 flex items-baseline gap-4">
          <span className="text-xs uppercase tracking-[0.22em] text-(--apply-ink-muted)">Co-Borrowers</span>
          <span className="flex-1 border-t border-(--apply-border)" aria-hidden />
        </div>
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
