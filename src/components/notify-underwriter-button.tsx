'use client'

// "Notify Underwriter" action used in two contexts:
//
//   variant="section" — pill-style button shown next to the Conditions
//                       section header. Whole-loan ping ("please review
//                       this file"). No conditionId.
//   variant="row"     — compact inline button on each condition row.
//                       Sends a ping about that specific condition;
//                       conditionId is required so the email subject /
//                       body name the condition.
//
// Both open the same popover (note textarea + Send/Cancel). The popover
// is anchored to the trigger; the section variant places it below, the
// row variant aligns right so it doesn't overflow narrow rows.

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
  /** Section button = whole-loan ping. Row button = single-condition. */
  variant?: 'section' | 'row'
  /** Required when variant === 'row'. Names the condition in the email. */
  conditionId?: string
  /** Shown in the popover header for the row variant ("Re: {title}"). */
  conditionTitle?: string
}

export function NotifyUnderwriterButton({
  loanId,
  underwriterName,
  variant = 'section',
  conditionId,
  conditionTitle,
}: Props) {
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
        body: JSON.stringify({
          loanId,
          message,
          ...(variant === 'row' && conditionId ? { conditionId } : {}),
        }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.success) {
        toast.success(underwriterName ? `Notified ${underwriterName}` : 'Underwriter notified')
        setOpen(false)
        setMessage('')
        router.refresh()
      } else {
        toast.error(data?.error ?? `Could not send (HTTP ${res.status})`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSending(false)
    }
  }

  // Trigger style: section variant matches the existing pill (h-7, text-xs);
  // row variant is smaller and lower-key so it fits next to the per-row
  // status/reassign controls without dominating them.
  const triggerClass = variant === 'section'
    ? `inline-flex items-center gap-1.5 h-7 px-3.5 text-xs font-medium border rounded-full whitespace-nowrap transition-colors ${
        disabled
          ? 'text-gray-400 bg-gray-50 border-gray-200 cursor-not-allowed'
          : 'text-gray-700 bg-white border-gray-300 hover:bg-gray-50'
      }`
    : `inline-flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors ${
        disabled
          ? 'text-gray-400 bg-gray-50 border-gray-200 cursor-not-allowed'
          : 'text-gray-600 bg-white border-gray-200 hover:bg-gray-50'
      }`

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        title={disabledReason}
        className={triggerClass}
      >
        <Mail className={variant === 'section' ? 'w-3.5 h-3.5' : 'w-3 h-3'} />
        {variant === 'section' ? 'Notify Underwriter' : 'Notify UW'}
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-80 bg-white border border-gray-200 rounded-md shadow-lg z-20 p-3 space-y-2">
          <div className="text-xs text-gray-600">
            Emailing <span className="font-medium text-gray-900">{underwriterName}</span>
            {variant === 'row' && conditionTitle && (
              <>
                {' '}about <span className="font-medium text-gray-900">&ldquo;{conditionTitle}&rdquo;</span>
              </>
            )}
          </div>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder={
              variant === 'row'
                ? 'Optional: what changed on this condition?'
                : 'Optional: what changed? (e.g. cash-out adjusted, please refresh DSCR)'
            }
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
