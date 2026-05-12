'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function InviteBorrower({ apiEndpoint = '/api/invite' }: { apiEndpoint?: string } = {}) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(false)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    setInviteLink(null)

    const res = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, fullName }),
    })

    const data = await res.json()

    if (!data.success) {
      setError(data.error ?? 'Something went wrong')
      setLoading(false)
      return
    }

    setInviteLink(data.inviteLink)
    setLoading(false)
  }

  async function handleCopy() {
    if (!inviteLink) return
    await navigator.clipboard.writeText(inviteLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleReset() {
    setOpen(false)
    setEmail('')
    setFullName('')
    setInviteLink(null)
    setError('')
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)} size="sm">
        Invite Borrower
      </Button>
    )
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-base">Invite Borrower</CardTitle>
      </CardHeader>
      <CardContent>
        {inviteLink ? (
          <div className="space-y-3">
            <p className="text-sm text-green-600 font-medium">✓ Invite link generated</p>
            <p className="text-sm text-gray-500">
              Copy this link and send it to <strong>{fullName || email}</strong>.
              It expires in 24 hours and can only be used once.
            </p>
            <div className="flex gap-2">
              <input
                readOnly
                value={inviteLink}
                className="flex-1 text-xs border rounded px-2 py-1.5 bg-gray-50 truncate"
              />
              <Button size="sm" onClick={handleCopy}>
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
            <p className="text-xs text-gray-400">
              After they set their password, assign their loan in the admin panel.
            </p>
            <Button variant="outline" size="sm" onClick={handleReset}>
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={handleInvite} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="invite-name">Full name</Label>
              <Input
                id="invite-name"
                placeholder="TBD Borrower"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email address</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="tbd@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>
            )}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={loading}>
                {loading ? 'Generating...' : 'Generate invite link'}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={handleReset}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
