'use client'

// "Notify Underwriter" header action on LO / LP / admin loan detail pages.
//
// Clicking opens an inline popover with a single textarea + Send button.
// Sending POSTs to /api/loans/notify-underwriter; the server fires the
// email and writes an audit row. Disabled (with tooltip) when the loan
// has no underwriter assigned — the underlying route enforces the same
// rule, but greying the button keeps users from clicking blindly.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Mail } from 'lucide-react'
import { useImpersonation } from '@/components/impersonation-provider'

interface Props {
  loanId: string
  /** Display name of the assigned UW. Used in the popover header so the
      sender knows who they're emailing. Null = no UW assigned. */
  underwriterName: string | null
}

export function NotifyUnderwriterButton({ loanId, underwriterName }: Props) {
  const router = useRouter()
  const { isImpersonating } = useImpersonation()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const disabled = !underwriterName || isImpersonating
  const disabledReason =
    isImpersonating ? 'Read-only preview — exit View As to act' :
    !underwriterName ? 'No underwriter assigned to this loan' :
    undefined

  // Click outside / Escape closes the popover.
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function send() {
    setSending(true)
    try {
      const res = await fetch('/api/loans/notify-underwriter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId, message }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.success) {
        toast.success(underwriterName ? `Notified ${underwriterName}` : 'Underwriter notified')
        setOpen(false)
        setMessage('')
        router.refresh()  // surface the audit log row in the Activity feed
      } else {
        toast.error(data?.error ?? `Could not send (HTTP ${res.status})`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        title={disabledReason}
        // Matches ViewAsDropdown + LoanAirtableSyncButton — pill, h-7, text-xs.
        className={`inline-flex items-center gap-1.5 h-7 px-3.5 text-xs font-medium border rounded-full whitespace-nowrap transition-colors ${
          disabled
            ? 'text-gray-400 bg-gray-50 border-gray-200 cursor-not-allowed'
            : 'text-gray-700 bg-white border-gray-300 hover:bg-gray-50'
        }`}
      >
        <Mail className="w-3.5 h-3.5" />
        Notify Underwriter
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-80 bg-white border border-gray-200 rounded-md shadow-lg z-20 p-3 space-y-2">
          <div className="text-xs text-gray-600">
            Emailing <span className="font-medium text-gray-900">{underwriterName}</span>
          </div>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Optional: what changed? (e.g. cash-out adjusted, please refresh DSCR)"
            rows={4}
            className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            autoFocus
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => { setOpen(false); setMessage('') }}
              disabled={sending}
              className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={send}
              disabled={sending}
              className="text-xs bg-primary text-white px-3 py-1.5 rounded-md hover:opacity-90 disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
