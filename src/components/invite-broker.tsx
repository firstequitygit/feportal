'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function InviteBroker({ apiEndpoint = '/api/invite-broker' }: { apiEndpoint?: string } = {}) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{
    emailSent: boolean
    inviteLink: string
    emailError: string | null
  } | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    setResult(null)

    const res = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, fullName, companyName }),
    })
    const data = await res.json()

    if (!data.success) {
      setError(data.error ?? 'Something went wrong')
      setLoading(false)
      return
    }

    setResult({
      emailSent: Boolean(data.emailSent),
      inviteLink: data.inviteLink,
      emailError: data.emailError ?? null,
    })
    setLoading(false)
  }

  async function handleCopy() {
    if (!result?.inviteLink) return
    await navigator.clipboard.writeText(result.inviteLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleReset() {
    setOpen(false)
    setEmail('')
    setFullName('')
    setCompanyName('')
    setResult(null)
    setError('')
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)} size="sm">
        Invite Broker
      </Button>
    )
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-base">Invite Broker</CardTitle>
      </CardHeader>
      <CardContent>
        {result ? (
          <div className="space-y-3">
            {result.emailSent ? (
              <>
                <p className="text-sm text-green-600 font-medium">✓ Invite email sent to {email}</p>
                <p className="text-sm text-gray-500">
                  {fullName || 'The broker'} will receive a message with a button to set up their account.
                  The link expires in 24 hours and can only be used once.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-amber-600 font-medium">
                  ⚠ Couldn&apos;t send the email automatically
                </p>
                <p className="text-sm text-gray-500">
                  Copy the link below and send it to <strong>{fullName || email}</strong> manually.
                  It expires in 24 hours and can only be used once.
                </p>
                {result.emailError && (
                  <p className="text-xs text-gray-400">Error: {result.emailError}</p>
                )}
              </>
            )}
            <details className="text-xs">
              <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
                {result.emailSent ? 'Need to copy the link manually instead?' : 'Show invite link'}
              </summary>
              <div className="mt-2 flex gap-2">
                <input
                  readOnly
                  value={result.inviteLink}
                  className="flex-1 text-xs border rounded px-2 py-1.5 bg-gray-50 truncate"
                />
                <Button size="sm" onClick={handleCopy}>
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
              </div>
            </details>
            <p className="text-xs text-gray-400">
              Next: open the loan and assign this broker so they can see it in their portal.
            </p>
            <Button variant="outline" size="sm" onClick={handleReset}>
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={handleInvite} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="invite-broker-name">Broker name</Label>
              <Input
                id="invite-broker-name"
                placeholder="Jane Broker"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-broker-company">Company (optional)</Label>
              <Input
                id="invite-broker-company"
                placeholder="Acme Mortgage"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-broker-email">Email address</Label>
              <Input
                id="invite-broker-email"
                type="email"
                placeholder="broker@example.com"
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
                {loading ? 'Sending...' : 'Send invite email'}
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
