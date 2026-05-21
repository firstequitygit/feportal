'use client'
import { type ApplicationData } from "@/lib/application-fields"

// Authorization signature is stored at data.auth_signature (root scope, primary borrower only).

const CERT_TEXT = `The Undersigned certifies the following: (1) I/We have applied for a mortgage loan through First Equity Funding, LP. In applying for the loan, I/We completed a loan application containing various information on the purpose of the loan, the amount and source of the down payment, employment and income information, and the assets and liabilities. I/We certify that all of the information is true and complete. I/We made no misrepresentations in the loan application or other documents, nor did I/We omit any pertinent information. (2) I/We understand and agree that First Equity Funding, LP reserves the right to change the mortgage loan review processes to a full documentation program. (3) I/We fully understand that it is a Federal crime punishable by fine or imprisonment, or both, to knowingly make any false statements when applying for this mortgage, as applicable under the provisions of Title 18, United States Code, Section 1014.`

const AUTH_TEXT = `AUTHORIZATION TO RELEASE INFORMATION — I/We have applied for a mortgage loan through First Equity Funding, LP. As part of the application process, First Equity Funding, LP and the mortgage guaranty insurer (if any), may verify information contained in my/our loan application and in other documents required in connection with the loan. I/We authorize First Equity Funding, LP and its affiliates to verify any information in the application. I/We further authorize the transmission of this application, and all documents associated herewith, to any and all investors, mortgage insurance companies, and other institutions that may be involved in the processing or funding of this loan. A copy of this authorization may be accepted as an original.`

export function Step5Authorization({ data, set, missingFields }: {
  data: ApplicationData
  set: (patch: Record<string, unknown>) => void
  missingFields?: string[]
}) {
  const primary = (data.primary as Record<string, unknown>) ?? {}
  const printed = [primary.first_name, primary.last_name].filter(Boolean).join(' ')
  const signature = (data.auth_signature as string) ?? ''
  const isInvalid = missingFields?.includes('auth_signature') ?? false

  return (
    <div className="space-y-8">
      {/* Certification block */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="text-base font-semibold text-gray-900">Borrowers&rsquo; Certification</h3>
        <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-xs text-gray-500 leading-relaxed border border-gray-200">
          {CERT_TEXT}
        </p>
      </div>

      {/* Authorization to Release block */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="text-base font-semibold text-gray-900">Authorization to Release Information</h3>
        <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-xs text-gray-500 leading-relaxed border border-gray-200">
          {AUTH_TEXT}
        </p>
      </div>

      {/* Signature block */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="text-base font-semibold text-gray-900">Signature</h3>

        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>
            Printed name:{' '}
            <strong className="text-gray-900">{printed || '—'}</strong>
          </span>
          <span className="text-gray-400">&middot;</span>
          <span>Date: {new Date().toLocaleDateString()}</span>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="f-auth_signature" className="text-sm font-medium text-gray-700">
            Type your full legal name as your signature
            <span className="text-red-500 ml-1" aria-label="required">*</span>
          </label>
          <input
            id="f-auth_signature"
            type="text"
            value={signature}
            onChange={e => set({ auth_signature: e.target.value })}
            placeholder="Type your full legal name"
            aria-invalid={isInvalid || undefined}
            className={`flex h-9 w-full rounded-md border bg-transparent px-3 text-sm outline-none transition-colors ${
              isInvalid
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
