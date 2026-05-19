'use client'
import { BORROWER_FIELDS, PRIMARY_EXTRA_FIELDS, type ApplicationData } from '@/lib/application-fields'
import { FieldRenderer } from '../_components/field-renderer'
import { RepeatingBorrowers } from '../_components/repeating-borrowers'

export function Step1Borrower({ data, set, ensureDraft }: {
  data: ApplicationData
  set: (patch: Record<string, unknown>) => void
  ensureDraft: (email: string, firstName: string) => void
}) {
  const primary = (data.primary as Record<string, unknown>) ?? {}
  const setPrimary = (name: string, value: unknown) => {
    set({ primary: { ...primary, [name]: value } })
    if (name === 'email' && typeof value === 'string' && value.includes('@'))
      ensureDraft(value, (primary.first_name as string) ?? '')
  }
  return (
    <div className="space-y-8">
      <FieldRenderer fields={[...BORROWER_FIELDS, ...PRIMARY_EXTRA_FIELDS]} data={data} scope={primary} onChange={setPrimary} />
      <div>
        <h3 className="mb-3 font-medium text-[#1F5D8F]">Co-Borrowers</h3>
        <RepeatingBorrowers data={data} fields={BORROWER_FIELDS} set={set} heading="Co-Borrower" />
      </div>
    </div>
  )
}
