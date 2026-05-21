'use client'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { type ApplicationData } from '@/lib/application-fields'

// Payment authorization signature is stored at data.payment_signature (root scope, primary only).
// Save-card agreement is stored at data.save_card_agree (boolean, root scope).

declare global { interface Window { Square?: unknown } }

type SquareCard = { attach: (sel: string) => Promise<void>; tokenize: () => Promise<{ status: string; token?: string }> }
type SquarePayments = { card: () => Promise<SquareCard> }
type SquareGlobal = { payments: (appId: string, locationId: string) => SquarePayments }

const PAYMENT_AUTH_TEXT = `By submitting payment you authorize First Equity Funding, LP to: (1) order a credit report and background check on all borrowers named in this application; (2) order an appraisal and any draw inspections as required for this loan; and (3) charge the card on file for the application processing fee described above. You acknowledge that all fees are non-refundable regardless of whether a loan is ultimately made. This authorization does not constitute a commitment by First Equity Funding, LP to make a loan, nor does it constitute a guarantee of any particular loan terms or approval.`

export function Step6Payment({ data, set, token }: {
  data: ApplicationData
  set: (patch: Record<string, unknown>) => void
  token: string | null
}) {
  const cardRef = useRef<SquareCard | null>(null)
  const [ready, setReady] = useState(false)
  const [saved, setSaved] = useState<{ last4: string; brand: string; feeCents: number } | null>(null)
  const cobs = Array.isArray(data.co_borrowers) ? (data.co_borrowers as unknown[]) : []
  const feeUsd = 45 // $45 flat per production spec

  const primary = (data.primary as Record<string, unknown>) ?? {}
  const printed = [primary.first_name, primary.last_name].filter(Boolean).join(' ')
  const paymentSignature = (data.payment_signature as string) ?? ''
  const saveCardAgree = data.save_card_agree === true

  useEffect(() => {
    const appId = process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID
    const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID
    const env = process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT === 'production' ? '' : 'sandbox.'
    if (!appId || !locationId) {
      console.error('[apply] Square env vars NEXT_PUBLIC_SQUARE_APPLICATION_ID / NEXT_PUBLIC_SQUARE_LOCATION_ID are missing — payment form cannot load.')
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

  async function saveCard() {
    if (!cardRef.current || !token) return
    if (!paymentSignature) { toast.error('Please sign the payment authorization before saving your card.'); return }
    if (!saveCardAgree) { toast.error('Please agree to save your card for future transactions.'); return }
    try {
      const result = await cardRef.current.tokenize()
      if (result.status !== 'OK' || !result.token) { toast.error('Card details invalid'); return }
      const res = await fetch('/api/apply/payment', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeToken: token, cardToken: result.token }),
      })
      const j = await res.json()
      if (j.success) { setSaved({ last4: j.last4 ?? '', brand: j.brand ?? '', feeCents: j.feeCents }); toast.success('Card saved') }
      else toast.error(j.error ?? 'Could not save card')
    } catch { toast.error('Network error — please try again') }
  }

  return (
    <div className="space-y-6">
      {/* Fee summary */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <p className="text-sm font-medium text-gray-700 mb-3">Fee Summary</p>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between text-gray-600">
            <span>Credit &amp; Background Check</span>
            <span>$45.00</span>
          </div>
          <div className="border-t border-gray-200 pt-2 flex justify-between font-medium text-gray-800">
            <span>Subtotal</span>
            <span>$45.00</span>
          </div>
          <div className="flex justify-between font-semibold text-[#1F5D8F] text-base">
            <span>Amount Due</span>
            <span>${feeUsd.toFixed(2)}</span>
          </div>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Your card is saved securely with Square and charged by our team after review — not now.
          {cobs.length > 0 && ` (${1 + cobs.length} borrowers on this application)`}
        </p>
      </div>

      {/* Payment authorization text */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="text-base font-semibold text-gray-900">Payment Authorization</h3>
        <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-xs text-gray-500 leading-relaxed border border-gray-200">
          {PAYMENT_AUTH_TEXT}
        </p>

        {/* Printed name + date */}
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>
            Printed name:{' '}
            <strong className="text-gray-900">{printed || '—'}</strong>
          </span>
          <span className="text-gray-400">&middot;</span>
          <span>Date: {new Date().toLocaleDateString()}</span>
        </div>

        {/* Payment signature */}
        <div className="space-y-1.5">
          <label htmlFor="f-payment_signature" className="text-sm font-medium text-gray-700">
            Type your full legal name as your signature
            <span className="text-red-500 ml-1" aria-label="required">*</span>
          </label>
          <input
            id="f-payment_signature"
            type="text"
            value={paymentSignature}
            onChange={e => set({ payment_signature: e.target.value })}
            placeholder="Type your full legal name"
            className="flex h-9 w-full rounded-md border border-gray-300 bg-transparent px-3 text-sm outline-none transition-colors focus:border-[#1F5D8F] focus:ring-1 focus:ring-[#1F5D8F]/30"
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

      {/* Save-card checkbox */}
      <label className="flex items-start gap-3 text-sm text-gray-600 cursor-pointer">
        <input
          type="checkbox"
          checked={saveCardAgree}
          onChange={e => set({ save_card_agree: e.target.checked })}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#1F5D8F] focus:ring-[#1F5D8F]/30"
        />
        <span>
          I agree to save my card for future transactions
          <span className="text-red-500 ml-1" aria-label="required">*</span>
        </span>
      </label>

      {/* Square card form */}
      {saved
        ? (
          <p className="text-sm font-medium text-[#1F5D8F]">
            Card saved: {saved.brand} &bull;&bull;{saved.last4}
          </p>
        )
        : (
          <>
            <div id="sq-card" className="rounded-md border border-gray-300 p-3" />
            <button
              type="button"
              onClick={saveCard}
              disabled={!ready || !token}
              className="inline-flex items-center rounded-md bg-[#1F5D8F] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0F3A5E] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60"
            >
              {ready ? 'Save card on file' : 'Loading payment form…'}
            </button>
            {!token && (
              <p className="text-xs text-red-600">
                Enter your email in Step 1 first so we can attach the card to your application.
              </p>
            )}
          </>
        )}
    </div>
  )
}
