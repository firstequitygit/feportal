'use client'

// Mentions section on the inbox dashboards. Shows the caller's unread
// @-mentions with a one-click "Mark all read" + per-row deep links.
//
// Server-rendered initial list; client-side state for the mark-read
// interactions so the row visibly disappears without a hard refresh.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { MentionInboxRow } from '@/lib/fetch-mentions'

interface Props {
  initial: MentionInboxRow[]
  /** Path prefix for deep linking — e.g. "/loan-officer" so the row
      links to /loan-officer/loans/{loanId}. */
  linkPrefix: string
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  const now = Date.now()
  const diffMs = now - d.getTime()
  const hours = Math.floor(diffMs / 3_600_000)
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function sourceLabel(kind: MentionInboxRow['source_kind']): string {
  switch (kind) {
    case 'staff_note':         return 'staff note'
    case 'condition_note':     return 'condition note'
    case 'condition_response': return 'condition response'
  }
}

export function MentionsCard({ initial, linkPrefix }: Props) {
  const router = useRouter()
  const [rows, setRows] = useState<MentionInboxRow[]>(initial)
  const [markingAll, setMarkingAll] = useState(false)

  async function markOne(id: string) {
    setRows(prev => prev.filter(r => r.id !== id))
    try {
      await fetch('/api/mentions/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mentionIds: [id] }),
      })
      router.refresh()  // updates the sidebar badge count on next nav
    } catch {
      toast.error('Could not mark as read')
    }
  }

  async function markAll() {
    setMarkingAll(true)
    const prev = rows
    setRows([])
    try {
      const res = await fetch('/api/mentions/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mentionIds: 'all' }),
      })
      if (!res.ok) {
        setRows(prev)
        toast.error('Could not mark all as read')
      } else {
        router.refresh()
      }
    } catch {
      setRows(prev)
      toast.error('Network error')
    } finally {
      setMarkingAll(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          Mentions
          {rows.length > 0 && (
            <span className="text-xs font-semibold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
              {rows.length}
            </span>
          )}
        </CardTitle>
        {rows.length > 0 && (
          <button
            onClick={markAll}
            disabled={markingAll}
            className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50"
          >
            {markingAll ? 'Marking…' : 'Mark all read'}
          </button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 && (
          <p className="text-sm text-gray-400">No unread mentions.</p>
        )}
        {rows.map(r => {
          // Deep link: condition-scoped mentions jump to the loan detail
          // page (which renders the condition list); staff-note mentions
          // go to the same place. We don't currently scroll to a
          // particular note/condition — future improvement.
          const href = `${linkPrefix}/loans/${r.loan_id}`
          return (
            <div key={r.id} className="group bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-500 mb-0.5">
                    <span className="font-medium text-gray-700">{r.mentioned_by_name ?? 'Someone'}</span>
                    {' mentioned you in a '}
                    {sourceLabel(r.source_kind)}
                    {r.property_address ? <> on <span className="font-medium text-gray-700">{r.property_address}</span></> : null}
                    {' · '}
                    {formatWhen(r.created_at)}
                  </p>
                  {r.excerpt && (
                    <p className="text-sm text-gray-900 line-clamp-2 whitespace-pre-wrap">{r.excerpt}</p>
                  )}
                  <Link
                    href={href}
                    onClick={() => markOne(r.id)}
                    className="text-xs text-primary hover:underline mt-1 inline-block"
                  >
                    Open loan →
                  </Link>
                </div>
                <button
                  onClick={() => markOne(r.id)}
                  className="text-xs text-gray-400 hover:text-gray-700 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  title="Mark as read"
                >
                  ✓
                </button>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
