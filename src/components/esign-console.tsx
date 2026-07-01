'use client'

// Staff E-Signature console. Pick a form + a loan, confirm the signer
// (defaults to the loan's primary borrower), and send via BoldSign.
// Shows recent envelopes with their status.

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchableSelect } from '@/components/searchable-select'

export interface EsignFormOption { key: string; label: string }
export interface EsignLoanOption {
  id: string
  name: string
  borrowerName: string | null
  borrowerEmail: string | null
}
export interface EsignEnvelopeRow {
  id: string
  documentLabel: string
  loanName: string
  signerName: string | null
  status: string
  sentAt: string | null
}

interface Props {
  forms: EsignFormOption[]
  loans: EsignLoanOption[]
  envelopes: EsignEnvelopeRow[]
}

const STATUS_STYLES: Record<string, string> = {
  sent:      'bg-blue-100 text-blue-700',
  viewed:    'bg-blue-100 text-blue-700',
  signed:    'bg-green-100 text-green-700',
  completed: 'bg-green-100 text-green-700',
  declined:  'bg-red-100 text-red-700',
  revoked:   'bg-gray-100 text-gray-600',
  expired:   'bg-gray-100 text-gray-600',
}

function statusLabel(s: string): string {
  if (s === 'completed' || s === 'signed') return 'Signed'
  if (s === 'sent') return 'Out for signature'
  if (s === 'viewed') return 'Viewed'
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function EsignConsole({ forms, loans, envelopes }: Props) {
  const [formKey, setFormKey] = useState<string>('')
  const [loanId, setLoanId] = useState<string | null>(null)
  const [signerName, setSignerName] = useState('')
  const [signerEmail, setSignerEmail] = useState('')
  const [sending, setSending] = useState(false)

  const loanById = useMemo(() => {
    const m = new Map<string, EsignLoanOption>()
    for (const l of loans) m.set(l.id, l)
    return m
  }, [loans])

  function onLoanChange(id: string | null) {
    setLoanId(id)
    const loan = id ? loanById.get(id) : null
    // Prefill the signer from the loan's primary borrower (editable).
    setSignerName(loan?.borrowerName ?? '')
    setSignerEmail(loan?.borrowerEmail ?? '')
  }

  async function send() {
    if (sending) return
    if (!formKey) { toast.error('Pick a form'); return }
    if (!loanId) { toast.error('Pick a loan'); return }
    if (!signerName.trim() || !signerEmail.trim()) { toast.error('Signer name and email are required'); return }
    setSending(true)
    try {
      const res = await fetch('/api/esign/form/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formKey, loanId, signerName: signerName.trim(), signerEmail: signerEmail.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success) {
        toast.success('Sent for signature')
        window.location.reload()
      } else {
        toast.error(data.error ?? 'Failed to send')
      }
    } catch {
      toast.error('Network error. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Send a document for signature</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Document</Label>
            <select
              value={formKey}
              onChange={e => setFormKey(e.target.value)}
              className="w-full text-sm px-3 py-2 rounded-md border border-gray-200 bg-white text-gray-700"
            >
              <option value="">— Select a form —</option>
              {forms.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label>Loan</Label>
            <SearchableSelect
              value={loanId}
              onChange={onLoanChange}
              options={loans.map(l => ({ id: l.id, label: l.name, sublabel: l.borrowerEmail ?? undefined }))}
              placeholder="Search loans…"
              emptyLabel="— None —"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Signer name</Label>
              <Input value={signerName} onChange={e => setSignerName(e.target.value)} placeholder="Borrower name" />
            </div>
            <div className="space-y-1.5">
              <Label>Signer email</Label>
              <Input type="email" value={signerEmail} onChange={e => setSignerEmail(e.target.value)} placeholder="borrower@email.com" />
            </div>
          </div>
          <p className="text-xs text-gray-400">
            Defaults to the loan&rsquo;s primary borrower — edit to send to a different signer.
          </p>

          <div>
            <Button onClick={send} disabled={sending}>
              {sending ? 'Sending…' : 'Send for Signature'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent requests</CardTitle>
        </CardHeader>
        <CardContent>
          {envelopes.length === 0 ? (
            <p className="text-sm text-gray-500">No signature requests yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="pb-2 pr-4 font-medium">Document</th>
                    <th className="pb-2 pr-4 font-medium">Loan</th>
                    <th className="pb-2 pr-4 font-medium">Signer</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 font-medium">Sent</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {envelopes.map(e => (
                    <tr key={e.id}>
                      <td className="py-2 pr-4 text-gray-900">{e.documentLabel}</td>
                      <td className="py-2 pr-4 text-gray-600 max-w-[220px] truncate">{e.loanName}</td>
                      <td className="py-2 pr-4 text-gray-600">{e.signerName ?? '—'}</td>
                      <td className="py-2 pr-4">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_STYLES[e.status] ?? 'bg-gray-100 text-gray-600'}`}>
                          {statusLabel(e.status)}
                        </span>
                      </td>
                      <td className="py-2 text-gray-400 whitespace-nowrap">
                        {e.sentAt ? new Date(e.sentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
