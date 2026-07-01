'use client'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Lock } from 'lucide-react'
import { toast } from 'sonner'
import { type ApplicationData } from "@/lib/application-fields"
import { ReviewSummary } from "../_components/review-summary"

// Authorization signature stored at data.auth_signature (root scope, primary borrower only).
// Payment authorization signature stored at data.payment_signature (root scope, primary borrower only).
// Save-card agreement stored at data.save_card_agree (boolean, root scope).

declare global { interface Window { Square?: unknown } }

type SquareCard = { attach: (sel: string) => Promise<void>; tokenize: () => Promise<{ status: string; token?: string }> }
type SquarePayments = { card: () => Promise<SquareCard> }
type SquareGlobal = { payments: (appId: string, locationId: string) => SquarePayments }

const CERT_TEXT = `The Undersigned certifies the following: (1) I/We have applied for a mortgage loan through First Equity Funding, LP. In applying for the loan, I/We completed a loan application containing various information on the purpose of the loan, the amount and source of the down payment, employment and income information, and the assets and liabilities. I/We certify that all of the information is true and complete. I/We made no misrepresentations in the loan application or other documents, nor did I/We omit any pertinent information. (2) I/We understand and agree that First Equity Funding, LP reserves the right to change the mortgage loan review processes to a full documentation program. (3) I/We fully understand that it is a Federal crime punishable by fine or imprisonment, or both, to knowingly make any false statements when applying for this mortgage, as applicable under the provisions of Title 18, United States Code, Section 1014.`

const AUTH_TEXT = `AUTHORIZATION TO RELEASE INFORMATION - I/We have applied for a mortgage loan through First Equity Funding, LP. As part of the application process, First Equity Funding, LP and the mortgage guaranty insurer (if any), may verify information contained in my/our loan application and in other documents required in connection with the loan. I/We authorize First Equity Funding, LP and its affiliates to verify any information in the application. I/We further authorize the transmission of this application, and all documents associated herewith, to any and all investors, mortgage insurance companies, and other institutions that may be involved in the processing or funding of this loan. A copy of this authorization may be accepted as an original.`

const PAYMENT_AUTH_TEXT = `By submitting payment you authorize First Equity Funding, LP to: (1) charge your card today for the application processing fee described above; (2) order a credit report and background check on all borrowers named in this application; (3) order an appraisal and any draw inspections as required for this loan; and (4) keep your card on file for any additional authorized charges. You acknowledge that all fees are non-refundable regardless of whether a loan is ultimately made. This authorization does not constitute a commitment by First Equity Funding, LP to make a loan, nor does it constitute a guarantee of any particular loan terms or approval.`

// Fee formula: $45 per borrower (primary + co-borrowers), capped at 4 borrowers.
// Source of truth for the server-side equivalent: feeCentsForBorrowerCount() in src/lib/square.ts.
function computeFeeUsd(borrowerCount: number): number {
  return Math.max(1, Math.min(4, borrowerCount)) * 45
}

// Result of a charge attempt driven by the wizard's Submit Application button.
// 'save_failed'/'incomplete' mean we never reached Square (pre-checks failed or the
// card could not be tokenized/saved); the wizard must NOT submit in those cases.
export type ChargeResult = {
  charged: boolean
  reason?: 'declined' | 'error' | 'in_review' | 'save_failed' | 'incomplete'
}

export type Step5Handle = {
  chargeFee: () => Promise<ChargeResult>
}

export const Step5Authorization = forwardRef<Step5Handle, {
  data: ApplicationData
  set: (patchOrFn: Record<string, unknown> | ((d: ApplicationData) => Record<string, unknown>)) => void
  missingFields?: string[]
  token: string | null
  onEdit?: (step: number) => void
  testMode?: boolean
}>(function Step5Authorization({ data, set, missingFields, token, onEdit, testMode = false }, ref) {
  const primary = (data.primary as Record<string, unknown>) ?? {}
  const printed = [primary.first_name, primary.last_name].filter(Boolean).join(' ')
  const signature = (data.auth_signature as string) ?? ''
  const paymentSignature = (data.payment_signature as string) ?? ''
  const saveCardAgree = data.save_card_agree === true
  const isAuthInvalid = missingFields?.includes('auth_signature') ?? false
  const isPaymentInvalid = missingFields?.includes('payment_signature') ?? false
  const cobs = Array.isArray(data.co_borrowers) ? (data.co_borrowers as unknown[]) : []
  const borrowerCount = 1 + cobs.length
  const feeUsd = computeFeeUsd(borrowerCount)

  const cardRef = useRef<SquareCard | null>(null)
  const [ready, setReady] = useState(false)
  const [saved, setSaved] = useState<{ last4: string; brand: string; feeCents: number } | null>(null)
  const [feeUncollected, setFeeUncollected] = useState(false)
  const [inlineError, setInlineError] = useState<string | null>(null)

  useEffect(() => {
    const appId = process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID
    const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID
    const env = process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT === 'production' ? '' : 'sandbox.'
    if (!appId || !locationId) {
      console.error('[apply] Square env vars NEXT_PUBLIC_SQUARE_APPLICATION_ID / NEXT_PUBLIC_SQUARE_LOCATION_ID are missing - payment form cannot load.')
      return
    }
    const src = `https://${env}web.squarecdn.com/v1/square.js`
    const existing = document.querySelector(`script[src="${src}"]`)
    const init = async () => {
      const sq = (window as unknown as { Square?: SquareGlobal }).Square
      if (!sq) return
      const payments = sq.payments(appId, locationId)
      const card = await payments.card()
      await card.attach('#sq-card')
      cardRef.current = card
      setReady(true)
    }
    if (existing) { void init(); return }
    const sc = document.createElement('script')
    sc.src = src; sc.onload = () => { void init() }; document.body.appendChild(sc)
  }, [])

  // Charge the application fee. Driven by the wizard's "Submit Application" button.
  // Runs the same pre-checks + tokenize + POST /api/apply/payment logic the old
  // "Pay application fee" button did, but returns a ChargeResult so the wizard can
  // decide whether to submit. Inline UI state (error / saved / feeUncollected) is
  // still updated so Step 5 shows the same messages to the borrower.
  async function chargeFee(): Promise<ChargeResult> {
    // Pre-checks: card ready, signature present, authorize box checked.
    if (!cardRef.current) {
      setInlineError('The payment form is still loading. Please wait a moment and try again.')
      return { charged: false, reason: 'incomplete' }
    }
    if (!testMode && !token) {
      setInlineError('Enter your email in Step 1 first so we can attach the card to your application.')
      return { charged: false, reason: 'incomplete' }
    }
    if (!paymentSignature) {
      setInlineError('Please sign the payment authorization above before submitting.')
      return { charged: false, reason: 'incomplete' }
    }
    if (!saveCardAgree) {
      setInlineError('Please check the box to authorize the application fee before submitting.')
      return { charged: false, reason: 'incomplete' }
    }

    setInlineError(null)

    try {
      // testMode: simulate a successful charge without hitting Square or the network.
      // Admins can click through to the "paid" state without real card credentials.
      if (testMode) {
        setSaved({ last4: '1111', brand: 'TEST', feeCents: feeUsd * 100 })
        toast.success('Test mode: simulated charge success')
        return { charged: true }
      }

      const result = await cardRef.current.tokenize()
      if (result.status !== 'OK' || !result.token) {
        setInlineError('Card details are invalid. Please check and try again.')
        return { charged: false, reason: 'save_failed' }
      }

      const res = await fetch('/api/apply/payment', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeToken: token, cardToken: result.token }),
      })

      // HTTP 502 = card could not be saved at all
      if (res.status === 502) {
        const j = await res.json().catch(() => ({})) as Record<string, unknown>
        setInlineError((j.error as string | undefined) ?? 'We couldn\'t save your card. Please re-check your card details.')
        return { charged: false, reason: 'save_failed' }
      }

      const j = await res.json() as {
        success?: boolean
        charged?: boolean
        alreadyCharged?: boolean
        brand?: string
        last4?: string
        feeCents?: number
        reason?: 'declined' | 'error' | 'in_review'
        error?: string
      }

      if (j.success && j.charged) {
        // Paid now (or was already paid idempotently)
        setSaved({ last4: j.last4 ?? '', brand: j.brand ?? '', feeCents: j.feeCents ?? feeUsd * 100 })
        toast.success(j.alreadyCharged ? 'Application fee already paid' : 'Application fee paid')
        return { charged: true }
      }

      if (j.success && !j.charged) {
        // Hard errors (error / in_review): our team follows up. The wizard shows the
        // in-page "couldn't confirm payment" confirm and still allows submit.
        if (j.reason === 'error' || j.reason === 'in_review') {
          setFeeUncollected(true)
          return { charged: false, reason: j.reason }
        }

        // Declined: surface the inline message. The wizard owns the attempt counter.
        setInlineError('Your card was declined. Please check the details or try a different card.')
        return { charged: false, reason: 'declined' }
      }

      // Unexpected response shape
      setInlineError(j.error ?? 'Something went wrong. Please try again.')
      return { charged: false, reason: 'save_failed' }
    } catch {
      setInlineError('Network error - please try again.')
      return { charged: false, reason: 'save_failed' }
    }
  }

  useImperativeHandle(ref, () => ({ chargeFee }))

  return (
    <div className="space-y-5">
      {/* Review recap */}
      {onEdit && (
        <ReviewSummary data={data} onEdit={onEdit} />
      )}

      {/* Certification block */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="text-base font-semibold text-gray-900">Borrowers&rsquo; Certification</h3>
        <p className="whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-xs text-gray-500 leading-relaxed border border-gray-200">
          {CERT_TEXT}
        </p>
      </div>

      {/* Authorization to Release block */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="text-base font-semibold text-gray-900">Authorization to Release Information</h3>
        <p className="whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-xs text-gray-500 leading-relaxed border border-gray-200">
          {AUTH_TEXT}
        </p>
      </div>

      {/* Loan authorization signature block */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="text-base font-semibold text-gray-900">Signature</h3>

        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>
            Printed name:{' '}
            <strong className="text-gray-900">{printed || '-'}</strong>
          </span>
          <span className="text-gray-400">&middot;</span>
          <span>Date: {new Date().toLocaleDateString()}</span>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="f-auth_signature" className="text-sm font-medium text-gray-700">
            Type your full legal name as your signature
            <span className="text-red-500" aria-hidden="true">*</span><span className="sr-only"> (required)</span>
          </label>
          <input
            id="f-auth_signature"
            type="text"
            value={signature}
            onChange={e => set({ auth_signature: e.target.value })}
            placeholder="Type your full legal name"
            aria-invalid={isAuthInvalid || undefined}
            className={`flex h-9 w-full rounded-md border bg-transparent px-3 text-sm outline-none transition-colors ${
              isAuthInvalid
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

      {/* Payment authorization text + signature */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="text-base font-semibold text-gray-900">Payment Authorization</h3>
        <p className="whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-xs text-gray-500 leading-relaxed border border-gray-200">
          {PAYMENT_AUTH_TEXT}
        </p>

        {/* Printed name + date */}
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>
            Printed name:{' '}
            <strong className="text-gray-900">{printed || '-'}</strong>
          </span>
          <span className="text-gray-400">&middot;</span>
          <span>Date: {new Date().toLocaleDateString()}</span>
        </div>

        {/* Payment signature */}
        <div className="space-y-1.5">
          <label htmlFor="f-payment_signature" className="text-sm font-medium text-gray-700">
            Type your full legal name as your signature
            <span className="text-red-500" aria-hidden="true">*</span><span className="sr-only"> (required)</span>
          </label>
          <input
            id="f-payment_signature"
            type="text"
            value={paymentSignature}
            onChange={e => set({ payment_signature: e.target.value })}
            placeholder="Type your full legal name"
            aria-invalid={isPaymentInvalid || undefined}
            className={`flex h-9 w-full rounded-md border bg-transparent px-3 text-sm outline-none transition-colors ${
              isPaymentInvalid
                ? 'border-red-500'
                : 'border-gray-300 focus:border-[#1F5D8F] focus:ring-1 focus:ring-[#1F5D8F]/30'
            }`}
          />
          {paymentSignature && (
            <div className="mt-2 flex items-baseline justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-3">
              <span
                className="text-2xl italic text-gray-900"
                style={{ fontFamily: "Georgia, serif" }}
              >
                {paymentSignature}
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

      {/* Fee summary */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <p className="text-sm font-medium text-gray-700 mb-3">Fee Summary</p>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between text-gray-600">
            <span>Credit &amp; Background Check{borrowerCount > 1 ? ` x ${borrowerCount} borrowers` : ''}</span>
            <span>${feeUsd.toFixed(2)}</span>
          </div>
          <div className="border-t border-gray-200 pt-2 flex justify-between font-medium text-gray-800">
            <span>Subtotal</span>
            <span>${feeUsd.toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-semibold text-[#1F5D8F] text-base">
            <span>Amount Due Today</span>
            <span>${feeUsd.toFixed(2)}</span>
          </div>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Your card will be charged ${feeUsd.toFixed(2)} today for the credit and background check. This fee is non-refundable.
        </p>
      </div>

      {/* Save-card checkbox */}
      <label className="flex items-start gap-3 text-sm text-gray-600 cursor-pointer">
        <input
          type="checkbox"
          checked={saveCardAgree}
          onChange={e => set({ save_card_agree: e.target.checked })}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#1F5D8F] focus:ring-[#1F5D8F]/30"
        />
        <span>
          I authorize First Equity Funding, LP to charge my card the application fee shown above and to keep my card on file.
          <span className="text-red-500 ml-1" aria-label="required">*</span>
        </span>
      </label>

      {/* Square card form / paid state / fee-uncollected state.
          The card is charged when the borrower clicks "Submit Application" in the
          wizard footer (via the chargeFee imperative handle), not from here. */}
      {saved
        ? (
          <p className="text-sm font-medium text-green-700">
            Paid ${(saved.feeCents / 100).toFixed(2)} - {saved.brand} &bull;&bull;{saved.last4}
          </p>
        )
        : feeUncollected
          ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Your payment is being processed and will be completed shortly. You can continue.
            </div>
          )
          : (
            <>
              <div id="sq-card" className="rounded-md border border-gray-300 p-3" />
              <p className="flex items-center gap-1.5 text-xs text-gray-400">
                <Lock className="h-3 w-3" aria-hidden="true" />
                Payments processed securely by Square
              </p>
              {inlineError && (
                <p className="text-sm text-red-600">{inlineError}</p>
              )}
              {!ready && (
                <p className="text-xs text-gray-500">Loading payment form...</p>
              )}
              {!token && !testMode && (
                <p className="text-xs text-red-600">
                  Enter your email in Step 1 first so we can attach the card to your application.
                </p>
              )}
              {testMode && (
                <p className="text-xs text-amber-700">
                  Test mode: clicking &quot;Submit Application&quot; will simulate a successful charge without hitting Square.
                </p>
              )}
            </>
          )}
    </div>
  )
})
