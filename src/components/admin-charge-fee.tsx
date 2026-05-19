'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function AdminChargeFee({ loanId, feeCents, chargedAt, last4, brand }: {
  loanId: string; feeCents: number | null; chargedAt: string | null; last4: string | null; brand: string | null
}) {
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(!!chargedAt)
  if (feeCents == null) return null
  async function charge() {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/loans/${loanId}/charge-fee`, { method: 'POST' })
      const j = await res.json()
      if (j.success) { setDone(true); toast.success('Fee charged') }
      else toast.error(j.error ?? 'Charge failed')
    } catch {
      toast.error('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Credit &amp; Background Fee</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">Amount: <strong>${(feeCents / 100).toFixed(2)}</strong>{brand && last4 ? ` · ${brand} ••${last4}` : ''}</p>
        {done
          ? <p className="text-sm text-green-600 font-medium">✓ Charged</p>
          : <Button size="sm" onClick={charge} disabled={loading}>{loading ? 'Charging…' : 'Charge saved card'}</Button>}
      </CardContent>
    </Card>
  )
}
