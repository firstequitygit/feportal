'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Bell } from 'lucide-react'
import { useImpersonation } from '@/components/impersonation-provider'

interface Props {
  loanId: string
  /** Loan has at least one borrower OR broker slot filled — hides
   *  the button if there's literally nobody to remind. The server
   *  decides which of those two parties actually receives the
   *  email (broker-wins rule). */
  hasRecipient: boolean
}

interface ReminderResult {
  party: 'borrower' | 'broker' | null
  sent: number
  conditionsCount: number
  skippedReason?: string
}

/**
 * Header "Send Reminder" button. One click → server picks the
 * recipient party using the broker-wins rule (broker on the loan →
 * broker(s) only, otherwise → borrower(s)). The toast reports which
 * party actually got the email, plus the item count.
 *
 * Shares the pill / h-7 / text-xs styling with ViewAsDropdown +
 * LoanAirtableSyncButton + the Approval Letter link so the loan
 * header action row stays visually consistent.
 */
export function ConditionReminderButton({ loanId, hasRecipient }: Props) {
  const router = useRouter()
  const { isImpersonating } = useImpersonation()
  const [sending, setSending] = useState(false)

  if (!hasRecipient) return null

  async function send() {
    setSending(true)
    const toastId = toast.loading('Sending reminder…')
    try {
      const res = await fetch('/api/loans/conditions/reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId }),
      })
      const data = await res.json().catch(() => null) as { success?: boolean; error?: string; result?: ReminderResult } | null
      if (!res.ok || !data?.success) {
        toast.error(data?.error ?? `Reminder failed (HTTP ${res.status})`, { id: toastId })
        return
      }
      const r = data.result
      if (!r || r.sent === 0 || !r.party) {
        const reason = r?.skippedReason === 'no_outstanding'
          ? 'No outstanding items to remind about'
          : r?.skippedReason === 'no_recipients'
            ? 'No reachable recipients on this loan'
            : r?.skippedReason === 'loan_inactive'
              ? 'Loan is inactive — nothing sent'
              : 'Nothing sent'
        toast.info(reason, { id: toastId, duration: 6000 })
        return
      }
      const partyLabel = r.party === 'borrower' ? 'borrower' : 'broker'
      toast.success(
        `Sent to ${partyLabel} · ${r.sent} email${r.sent !== 1 ? 's' : ''} · ${r.conditionsCount} outstanding item${r.conditionsCount !== 1 ? 's' : ''}`,
        { id: toastId, duration: 6000 },
      )
      // Activity log shows the new event — refresh so the user sees it.
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reminder failed', { id: toastId })
    } finally {
      setSending(false)
    }
  }

  const disabled = sending || isImpersonating

  return (
    <button
      type="button"
      onClick={disabled ? undefined : send}
      disabled={disabled}
      title={isImpersonating ? 'Read-only preview — exit View As to act' : 'Email an outstanding-conditions reminder'}
      className={`inline-flex items-center gap-1.5 h-7 px-3.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-full hover:bg-gray-50 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed ${isImpersonating ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <Bell className={`w-3.5 h-3.5 ${sending ? 'animate-pulse' : ''}`} />
      {sending ? 'Sending…' : 'Send Reminder'}
    </button>
  )
}
