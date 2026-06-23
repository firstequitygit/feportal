'use client'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

declare global { interface Window { Square?: unknown } }

type SquareCard = { attach: (sel: string) => Promise<void>; tokenize: () => Promise<{ status: string; token?: string }> }
type SquarePayments = { card: () => Promise<SquareCard> }
type SquareGlobal = { payments: (appId: string, locationId: string) => SquarePayments }

const CERT_TEXT = `The Undersigned certifies the following: (1) I/We have applied for a mortgage loan through First Equity Funding, LP. In applying for the loan, I/We completed a loan application containing various information on the purpose of the loan, the amount and source of the down payment, employment and income information, and the assets and liabilities. I/We certify that all of the information is true and complete. I/We made no misrepresentations in the loan application or other documents, nor did I/We omit any pertinent information. (2) I/We understand and agree that First Equity Funding, LP reserves the right to change the mortgage loan review processes to a full documentation program. (3) I/We fully understand that it is a Federal crime punishable by fine or imprisonment, or both, to knowingly make any false statements when applying for this mortgage, as applicable under the provisions of Title 18, United States Code, Section 1014.`

const AUTH_TEXT = `AUTHORIZATION TO RELEASE INFORMATION - I/We have applied for a mortgage loan through First Equity Funding, LP. As part of the application process, First Equity Funding, LP and the mortgage guaranty insurer (if any), may verify information contained in my/our loan application and in other documents required in connection with the loan. I/We authorize First Equity Funding, LP and its affiliates to verify any information in the application. I/We further authorize the transmission of this application, and all documents associated herewith, to any and all investors, mortgage insurance companies, and other institutions that may be involved in the processing or funding of this loan. A copy of this authorization may be accepted as an original.`

const PAYMENT_AUTH_TEXT = `By submitting payment you authorize First Equity Funding, LP to: (1) charge your card today for the application processing fee described above; (2) order a credit report and background check on all borrowers named in this application; (3) order an appraisal and any draw inspections as required for this loan; and (4) keep your card on file for any additional authorized charges. You acknowledge that all fees are non-refundable regardless of whether a loan is ultimately made. This authorization does not constitute a commitment by First Equity Funding, LP to make a loan, nor does it constitute a guarantee of any particular loan terms or approval.`

const MAX_ATTEMPTS = 3

export function AuthorizeForm({ token, borrowerName, feeUsd, borrowerCount }: {
  token: string
  borrowerName: string
  feeUsd: number
  borrowerCount: number
}) {
  const [signature, setSignature] = useState('')
  const [paymentSignature, setPaymentSignature] = useState('')
  const [saveCardAgree, setSaveCardAgree] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [attemptCount, setAttemptCount] = useState(0)
  const [inlineError, setInlineError] = useState<string | null>(null)
  const [paid, setPaid] = useState<{ brand: string; last4: string } | null>(null)
  const [feeUncollected, setFeeUncollected] = useState(false)
  const cardRef = useRef<SquareCard | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const appId = process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID
    const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID
    const env = process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT === 'production' ? '' : 'sandbox.'
    if (!appId || !locationId) {
      console.error('[authorize] Square env vars missing - payment form cannot load.')
      return
    }
    const src = `https://${env}web.squarecdn.com/v1/square.js`
    const existing = document.querySelector(`script[src="${src}"]`)
    const init = async () => {
      const sq = (window as unknown as { Square?: SquareGlobal }).Square
      if (!sq) return
      const payments = sq.payments(appId, locationId)
      const card = await payments.card()
      await card.attach('#sq-authorize-card')
      cardRef.current = card
      setReady(true)
    }
    if (existing) { void init(); return }
    const sc = document.createElement('script')
    sc.src = src; sc.onload = () => { void init() }; document.body.appendChild(sc)
  }, [])

  async function submit() {
    if (!signature) { toast.error('Please sign the borrower certification.'); return }
    if (!paymentSignature) { toast.error('Please sign the payment authorization.'); return }
    if (!saveCardAgree) { toast.error('Please agree to authorize the application fee.'); return }
    if (!cardRef.current) { toast.error('Payment form is still loading - please wait a moment.'); return }

    setInlineError(null)
    setSubmitting(true)
    try {
      const result = await cardRef.current.tokenize()
      if (result.status !== 'OK' || !result.token) {
        setInlineError('Card details are invalid. Please check and try again.')
        return
      }

      const res = await fetch(`/api/authorize/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authSignature: signature,
          paymentSignature,
          saveCardAgree,
          cardToken: result.token,
        }),
      })

      // HTTP 502 = card could not be saved
      if (res.status === 502) {
        const j = await res.json().catch(() => ({})) as Record<string, unknown>
        setInlineError((j.error as string | undefined) ?? 'We couldn\'t save your card. Please re-check your card details.')
        return
      }

      const j = await res.json() as {
        success?: boolean
        alreadySigned?: boolean
        charged?: boolean
        brand?: string
        last4?: string
        reason?: 'declined' | 'error'
        error?: string
      }

      if (j.success) {
        if (j.charged) {
          setPaid({ brand: j.brand ?? '', last4: j.last4 ?? '' })
          toast.success('Authorization complete - fee paid')
        } else if (!j.charged && j.reason) {
          // Authorization was recorded but charge failed
          const newAttempts = attemptCount + 1
          setAttemptCount(newAttempts)

          if (newAttempts >= MAX_ATTEMPTS) {
            // Cap reached - complete the authorization anyway; team will follow up on fee
            setFeeUncollected(true)
            toast.success('Authorization complete')
            window.location.reload()
            return
          }

          if (j.reason === 'declined') {
            setInlineError('Your card was declined. Please check the details or try a different card.')
          } else {
            setInlineError('We couldn\'t process the payment right now. Please try again.')
          }
          return
        } else {
          toast.success('Authorization complete')
        }
        window.location.reload()
        return
      }

      setInlineError(j.error ?? 'Could not save authorization')
    } catch (err) {
      console.error('Authorize submit failed', err)
      setInlineError('Network error - please try again')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="text-base font-semibold text-gray-900">Borrowers&rsquo; Certification</h3>
        <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-xs text-gray-500 leading-relaxed border border-gray-200">
          {CERT_TEXT}
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="text-base font-semibold text-gray-900">Authorization to Release Information</h3>
        <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-xs text-gray-500 leading-relaxed border border-gray-200">
          {AUTH_TEXT}
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="text-base font-semibold text-gray-900">Signature</h3>
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>Printed name: <strong className="text-gray-900">{borrowerName || '-'}</strong></span>
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
            onChange={e => setSignature(e.target.value)}
            placeholder="Type your full legal name"
            className="flex h-9 w-full rounded-md border border-gray-300 bg-transparent px-3 text-sm outline-none transition-colors focus:border-[#1F5D8F] focus:ring-1 focus:ring-[#1F5D8F]/30"
          />
          {signature && (
            <div className="mt-2 flex items-baseline justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-3">
              <span className="text-2xl italic text-gray-900" style={{ fontFamily: 'Georgia, serif' }}>{signature}</span>
              <span className="text-xs text-gray-500">{new Date().toLocaleDateString()}</span>
            </div>
          )}
          <p className="text-xs text-gray-500">By typing your name above, you are signing this document electronically.</p>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="text-base font-semibold text-gray-900">Payment Authorization</h3>
        <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-xs text-gray-500 leading-relaxed border border-gray-200">
          {PAYMENT_AUTH_TEXT}
        </p>
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>Printed name: <strong className="text-gray-900">{borrowerName || '-'}</strong></span>
          <span className="text-gray-400">&middot;</span>
          <span>Date: {new Date().toLocaleDateString()}</span>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="f-payment_signature" className="text-sm font-medium text-gray-700">
            Type your full legal name as your signature
            <span className="text-red-500" aria-hidden="true">*</span><span className="sr-only"> (required)</span>
          </label>
          <input
            id="f-payment_signature"
            type="text"
            value={paymentSignature}
            onChange={e => setPaymentSignature(e.target.value)}
            placeholder="Type your full legal name"
            className="flex h-9 w-full rounded-md border border-gray-300 bg-transparent px-3 text-sm outline-none transition-colors focus:border-[#1F5D8F] focus:ring-1 focus:ring-[#1F5D8F]/30"
          />
          {paymentSignature && (
            <div className="mt-2 flex items-baseline justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-3">
              <span className="text-2xl italic text-gray-900" style={{ fontFamily: 'Georgia, serif' }}>{paymentSignature}</span>
              <span className="text-xs text-gray-500">{new Date().toLocaleDateString()}</span>
            </div>
          )}
          <p className="text-xs text-gray-500">By typing your name above, you are signing this document electronically.</p>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <p className="text-sm font-medium text-gray-700 mb-3">Fee Summary</p>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between text-gray-600">
            <span>Credit &amp; Background Check{borrowerCount > 1 ? ` x ${borrowerCount} borrowers` : ''}</span>
            <span>${feeUsd.toFixed(2)}</span>
          </div>
          <div className="border-t border-gray-200 pt-2 flex justify-between font-medium text-gray-800"><span>Subtotal</span><span>${feeUsd.toFixed(2)}</span></div>
          <div className="flex justify-between font-semibold text-[#1F5D8F] text-base"><span>Amount Due Today</span><span>${feeUsd.toFixed(2)}</span></div>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Your card will be charged ${feeUsd.toFixed(2)} today for the credit and background check. This fee is non-refundable.
          {borrowerCount > 1 && ` (${borrowerCount} borrowers on this application)`}
        </p>
      </div>

      <label className="flex items-start gap-3 text-sm text-gray-600 cursor-pointer">
        <input
          type="checkbox"
          checked={saveCardAgree}
          onChange={e => setSaveCardAgree(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#1F5D8F] focus:ring-[#1F5D8F]/30"
        />
        <span>
          I authorize First Equity Funding, LP to charge my card the application fee shown above and to keep my card on file.
          <span className="text-red-500 ml-1" aria-label="required">*</span>
        </span>
      </label>

      {paid
        ? (
          <p className="text-sm font-medium text-green-700">
            Paid ${feeUsd.toFixed(2)} - {paid.brand} &bull;&bull;{paid.last4}
          </p>
        )
        : feeUncollected
          ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Authorization recorded. We could not collect the application fee at this time - our team will follow up about payment.
            </div>
          )
          : (
            <>
              <div id="sq-authorize-card" className="rounded-md border border-gray-300 p-3" />
              {inlineError && (
                <p className="text-sm text-red-600">{inlineError}</p>
              )}
              {attemptCount > 0 && attemptCount < MAX_ATTEMPTS && (
                <p className="text-xs text-gray-500">Attempt {attemptCount} of {MAX_ATTEMPTS}. After {MAX_ATTEMPTS} failed attempts your authorization will still be recorded.</p>
              )}
              <button
                type="button"
                onClick={submit}
                disabled={!ready || submitting}
                className="inline-flex items-center rounded-md bg-[#1F5D8F] px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0F3A5E] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60"
              >
                {submitting ? 'Submitting...' : ready ? 'Complete Authorization' : 'Loading payment form...'}
              </button>
            </>
          )}
    </div>
  )
}
