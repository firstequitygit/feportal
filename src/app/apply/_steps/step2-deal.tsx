'use client'
import { DEAL_FIELDS, dscrUnitCount, type ApplicationData } from '@/lib/application-fields'
import { FieldRenderer } from '../_components/field-renderer'
import { RepeatingUnits } from '../_components/repeating-units'
import { PropertyDocuments, type PropertyDoc } from '../_components/property-documents'

export function Step2Deal({ data, set, missingFields, token, testMode = false }: {
  data: ApplicationData
  set: (patchOrFn: Record<string, unknown> | ((d: ApplicationData) => Record<string, unknown>)) => void
  missingFields?: string[]
  token: string | null
  testMode?: boolean
}) {
  const gateField = DEAL_FIELDS.find(f => f.name === 'has_deal')!
  const restFields = DEAL_FIELDS.filter(f => f.name !== 'has_deal')
  // For DSCR Single Family / Condo, dscrUnitCount returns 1 but the "Rental income"
  // section in restFields has no visible fields, so FieldRenderer never renders the
  // section heading. We render it ourselves before RepeatingUnits in that case.
  const unitCount = dscrUnitCount(data)
  const needsRentalHeading =
    unitCount > 0 &&
    (data.property_type === 'Single Family' || data.property_type === 'Condo')

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
          {/* RepeatingUnits is self-gating: returns null when dscrUnitCount === 0.
              For DSCR Single Family/Condo the "Rental income" FieldRenderer section
              has no visible fields so no heading renders there; we add it here.
              For DSCR Multifamily the FieldRenderer already renders the "Rental income"
              heading + dscr_unit_count select, so no extra heading needed. */}
          {needsRentalHeading && (
            <div className="mt-4 mb-1.5 border-b border-gray-200 pb-1.5">
              <h3 className="text-sm font-semibold text-gray-900">Rental income</h3>
            </div>
          )}
          <RepeatingUnits data={data} set={set} missingFields={missingFields} />
          <div className="pt-2">
            <PropertyDocuments
              token={token}
              documents={(data.property_documents as PropertyDoc[] | undefined) ?? []}
              set={set}
              testMode={testMode}
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
