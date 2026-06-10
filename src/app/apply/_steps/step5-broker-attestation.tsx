'use client'
import { type ApplicationData } from "@/lib/application-fields"
import { ReviewSummary } from "../_components/review-summary"

// Broker attestation signature stored at data.broker_attestation_signature
// (root scope). The borrower's credit auth + payment is captured separately
// at /authorize/<token> after submit; this step is broker-only.

export function Step5BrokerAttestation({ data, set, missingFields, onEdit, variantCopy }: {
  data: ApplicationData
  set: (patchOrFn: Record<string, unknown> | ((d: ApplicationData) => Record<string, unknown>)) => void
  missingFields?: string[]
  onEdit?: (step: number) => void
  variantCopy: { step5AttestationLabel: string; step5AttestationBody: string }
}) {
  const primary = (data.primary as Record<string, unknown>) ?? {}
  const borrowerPrinted = [primary.first_name, primary.last_name].filter(Boolean).join(' ')
  const signature = (data.broker_attestation_signature as string) ?? ''
  const isSignatureInvalid = missingFields?.includes('broker_attestation_signature') ?? false
  const brokerName = (primary.broker_full_name as string) ?? ''
  const brokerEmail = (primary.broker_email as string) ?? ''

  return (
    <div className="space-y-5">
      {/* Review recap */}
      {onEdit && (
        <ReviewSummary data={data} onEdit={onEdit} />
      )}

      {/* Broker certification block */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="text-base font-semibold text-gray-900">{variantCopy.step5AttestationLabel}</h3>
        <p className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-xs text-gray-500 leading-relaxed border border-gray-200">
          {variantCopy.step5AttestationBody}
        </p>
      </div>

      {/* Broker signature block */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="text-base font-semibold text-gray-900">Signature</h3>

        {/* Pre-filled context — broker from Step 1, borrower from the form data */}
        <dl className="grid grid-cols-1 gap-2 text-sm text-gray-600 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-gray-500">Broker</dt>
            <dd className="font-medium text-gray-900">{brokerName || '-'}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Email</dt>
            <dd className="font-medium text-gray-900">{brokerEmail || '-'}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Borrower</dt>
            <dd className="font-medium text-gray-900">{borrowerPrinted || '-'}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Date</dt>
            <dd className="font-medium text-gray-900">{new Date().toLocaleDateString()}</dd>
          </div>
        </dl>

        <div className="space-y-1.5">
          <label htmlFor="f-broker_attestation_signature" className="text-sm font-medium text-gray-700">
            Type your full legal name as your signature
            <span className="text-red-500" aria-hidden="true">*</span><span className="sr-only"> (required)</span>
          </label>
          <input
            id="f-broker_attestation_signature"
            type="text"
            value={signature}
            onChange={e => set({ broker_attestation_signature: e.target.value })}
            placeholder="Type your full legal name"
            aria-invalid={isSignatureInvalid || undefined}
            className={`flex h-9 w-full rounded-md border bg-transparent px-3 text-sm outline-none transition-colors ${
              isSignatureInvalid
                ? 'border-red-500'
                : 'border-gray-300 focus:border-[#1F5D8F] focus:ring-1 focus:ring-[#1F5D8F]/30'
            }`}
          />
          {signature && (
            <div className="mt-2 flex items-baseline justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-3">
              <span
                className="text-2xl italic text-gray-900"
                style={{ fontFamily: "Georgia, serif" }}
              >
                {signature}
              </span>
              <span className="text-xs text-gray-500">
                {new Date().toLocaleDateString()}
              </span>
            </div>
          )}
          <p className="text-xs text-gray-500">
            By typing your name above, you are signing this document electronically.
          </p>
        </div>
      </div>
    </div>
  )
}
