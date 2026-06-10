'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Borrower {
  full_name: string | null
  email: string
  phone: string | null
  /** When set, this borrower has a portal login, so their email is their sign-in identity and cannot be changed here. */
  auth_user_id: string | null
}

interface Props {
  loanId: string
  borrower: Borrower
}

export function EditableBorrowerContact({ loanId, borrower }: Props) {
  const router = useRouter()
  const emailLocked = !!borrower.auth_user_id
  const [editing, setEditing] = useState(false)
  const [fullName, setFullName] = useState(borrower.full_name ?? '')
  const [email, setEmail] = useState(borrower.email)
  const [phone, setPhone] = useState(borrower.phone ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    const res = await fetch('/api/loans/borrower-contact', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        loanId,
        full_name: fullName.trim() || null,
        // When locked, send the unchanged email so the server's guard passes.
        email: emailLocked ? borrower.email : email.trim(),
        phone: phone.trim() || null,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (data.success) {
      setEditing(false)
      router.refresh()
    } else {
      setError(data.error ?? 'Could not save')
    }
    setSaving(false)
  }

  function handleCancel() {
    setFullName(borrower.full_name ?? '')
    setEmail(borrower.email)
    setPhone(borrower.phone ?? '')
    setEditing(false)
    setError(null)
  }

  if (editing) {
    return (
      <div className="space-y-2">
        <div className="flex justify-between items-center gap-3">
          <span className="text-gray-500">Name</span>
          <input
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            placeholder="Full name"
            className="text-sm border border-gray-200 rounded px-2 py-0.5 focus:outline-none focus:border-primary w-48 text-right"
            autoFocus
          />
        </div>
        <div className="flex justify-between items-center gap-3">
          <span className="text-gray-500">Email</span>
          {emailLocked ? (
            <span className="font-medium text-gray-900 text-right">{borrower.email}</span>
          ) : (
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Email"
              className="text-sm border border-gray-200 rounded px-2 py-0.5 focus:outline-none focus:border-primary w-48 text-right"
            />
          )}
        </div>
        {emailLocked && (
          <p className="text-xs text-gray-400 text-right">
            Email is the borrower&apos;s portal sign-in and can&apos;t be changed here.
          </p>
        )}
        <div className="flex justify-between items-center gap-3">
          <span className="text-gray-500">Phone</span>
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="(555) 555-5555"
            className="text-sm border border-gray-200 rounded px-2 py-0.5 focus:outline-none focus:border-primary w-48 text-right"
          />
        </div>
        <div className="flex items-center gap-2 justify-end pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs text-white bg-primary hover:opacity-90 disabled:opacity-50 px-2 py-1 rounded font-medium"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={handleCancel}
            disabled={saving}
            className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
        {error && <p className="text-xs text-red-600 text-right">{error}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center gap-3">
        <span className="text-gray-500">Name</span>
        <span className="font-medium">{borrower.full_name ?? '—'}</span>
      </div>
      <div className="flex justify-between items-center gap-3">
        <span className="text-gray-500">Email</span>
        <a href={`mailto:${borrower.email}`} className="font-medium text-primary hover:opacity-80">
          {borrower.email}
        </a>
      </div>
      <div className="flex justify-between items-center gap-3">
        <span className="text-gray-500">Phone</span>
        <span className="font-medium">{borrower.phone ?? '—'}</span>
      </div>
      <div className="flex justify-end">
        <button
          onClick={() => setEditing(true)}
          className="text-xs text-gray-400 hover:text-primary transition-colors"
          title="Edit borrower contact details"
        >
          edit
        </button>
      </div>
    </div>
  )
}
