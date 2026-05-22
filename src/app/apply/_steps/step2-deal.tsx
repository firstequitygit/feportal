'use client'
import { DEAL_FIELDS, type ApplicationData } from '@/lib/application-fields'
import { FieldRenderer } from '../_components/field-renderer'
import { RepeatingUnits } from '../_components/repeating-units'
import { PropertyDocuments, type PropertyDoc } from '../_components/property-documents'

export function Step2Deal({ data, set, missingFields, token }: {
  data: ApplicationData
  set: (patch: Record<string, unknown>) => void
  missingFields?: string[]
  token: string | null
}) {
  const gateField = DEAL_FIELDS.find(f => f.name === 'has_deal')!
  const restFields = DEAL_FIELDS.filter(f => f.name !== 'has_deal')

  return (
    <div className="space-y-5">
      <FieldRenderer
        fields={[gateField]}
        data={data}
        scope={data}
        onChange={(n, v) => set({ [n]: v })}
        missingFields={missingFields}
      />

      {data.has_deal === true && (
        <>
          <FieldRenderer
            fields={restFields}
            data={data}
            scope={data}
            onChange={(n, v) => set({ [n]: v })}
            missingFields={missingFields}
          />
          <RepeatingUnits data={data} set={set} missingFields={missingFields} />
          <div className="pt-2">
            <PropertyDocuments
              token={token}
              documents={(data.property_documents as PropertyDoc[] | undefined) ?? []}
              set={set}
            />
          </div>
        </>
      )}

      {data.has_deal === false && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">Let&apos;s get you a pre-approval instead.</p>
          <p className="mt-1">
            No problem. If you don&apos;t have a specific property yet, we can issue a
            proof-of-funds letter or pre-approval. Please contact your First Equity
            loan officer to get started. Online pre-approval coming soon.
          </p>
        </div>
      )}
    </div>
  )
}
