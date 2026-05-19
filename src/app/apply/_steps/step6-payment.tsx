'use client'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { type ApplicationData } from '@/lib/application-fields'

declare global { interface Window { Square?: unknown } }

type SquareCard = { attach: (sel: string) => Promise<void>; tokenize: () => Promise<{ status: string; token?: string }> }
type SquarePayments = { card: () => Promise<SquareCard> }
type SquareGlobal = { payments: (appId: string, locationId: string) => SquarePayments }

export function Step6Payment({ data, token }: {
  data: ApplicationData; token: string | null
}) {
  const cardRef = useRef<SquareCard | null>(null)
  const [ready, setReady] = useState(false)
  const [saved, setSaved] = useState<{ last4: string; brand: string; feeCents: number } | null>(null)
  const cobs = Array.isArray(data.co_borrowers) ? (data.co_borrowers as unknown[]) : []
  const feeUsd = (1 + cobs.length) * 45

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
    <div className="space-y-4">
      <div className="rounded-lg border p-4">
        <p className="text-sm">Credit &amp; Background Check</p>
        <p className="text-2xl font-semibold text-[#1F5D8F]">${feeUsd.toFixed(2)}</p>
        <p className="text-xs text-muted-foreground">$45 × {1 + cobs.length} borrower(s). Your card is saved securely with Square and charged by our team after review — not now.</p>
      </div>
      {saved
        ? <p className="text-sm text-green-600 font-medium">✓ Card saved: {saved.brand} ••{saved.last4}</p>
        : <>
            <div id="sq-card" className="rounded-md border p-3" />
            <Button onClick={saveCard} disabled={!ready || !token}>{ready ? 'Save card on file' : 'Loading payment form…'}</Button>
            {!token && <p className="text-xs text-red-600">Enter your email in Step 1 first so we can attach the card to your application.</p>}
          </>}
    </div>
  )
}
