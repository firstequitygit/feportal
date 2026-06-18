'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Wizard } from './wizard'

type View = 'choose' | 'new' | 'login'
type LoginMode = 'email' | 'code'

export function ApplyGate({ loanOfficerOptions }: { loanOfficerOptions: string[] }) {
  const router = useRouter()
  const supabase = createClient()

  const [view, setView] = useState<View>('choose')
  const [loginMode, setLoginMode] = useState<LoginMode>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // New borrower: render the standard blank wizard inline (no navigation).
  if (view === 'new') {
    return (
      <Wizard
        initialData={{}}
        initialStep={1}
        initialToken={null}
        isAdmin={false}
        loanOfficerOptions={loanOfficerOptions}
        variantKind="borrower"
        authenticated={false}
      />
    )
  }

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    // shouldCreateUser:false: an unknown email never creates an account here.
    // Supabase returns { error: null } for unknown emails (sends nothing silently),
    // so we always advance to the code screen for valid sends - avoiding email enumeration.
    // Only genuine send failures (network/config) take the error path.
    try {
      const { error: sendError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/apply`,
        },
      })
      if (sendError) {
        setError('Could not send a code. Please check your email address and try again.')
        return
      }
      setLoginMode('code')
    } catch {
      setError('Could not send a code. Please check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: 'email',
    })
    if (verifyError) {
      setError('That code is invalid or expired. Try again or request a new one.')
      setLoading(false)
      return
    }
    // Session cookie is now set. Re-render the server page; it will see an
    // authenticated borrower and return the pre-filled wizard at this same URL.
    router.refresh()
  }

  return (
    <div className="mx-auto max-w-md px-6 py-10">
      <div className="mb-8 text-center">
        <Image src="/logo-main.png" alt="First Equity Funding" width={724} height={86} className="mx-auto mb-3 h-16 w-auto" />
      </div>

      {view === 'choose' && (
        <Card>
          <CardHeader>
            <CardTitle>Apply for a loan</CardTitle>
            <CardDescription>Let us know if you have worked with us before.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              <Button
                type="button"
                className="h-12 text-base font-semibold"
                onClick={() => setView('new')}
              >
                I am a new borrower
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-12 text-base font-medium"
                onClick={() => { setView('login'); setLoginMode('email'); setError('') }}
              >
                I am a returning customer
              </Button>
            </div>
            <p className="mt-4 text-center text-xs text-gray-400">
              Returning customers sign in so we can pre-fill your saved information.
            </p>
          </CardContent>
        </Card>
      )}

      {view === 'login' && loginMode === 'email' && (
        <Card>
          <CardHeader>
            <CardTitle>Welcome back</CardTitle>
            <CardDescription>Enter your email and we will send you a sign-in code.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSendCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="apply-email">Email address</Label>
                <Input
                  id="apply-email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>
              )}
              <Button type="submit" className="w-full h-11 text-base font-semibold" disabled={loading}>
                {loading ? 'Sending…' : 'Send sign-in code'}
              </Button>
            </form>
            <button
              type="button"
              onClick={() => { setView('choose'); setError('') }}
              className="mt-4 w-full text-center text-sm text-gray-500 hover:text-gray-800"
            >
              ← I am actually a new borrower
            </button>
          </CardContent>
        </Card>
      )}

      {view === 'login' && loginMode === 'code' && (
        <Card>
          <CardHeader>
            <CardTitle>Check your email</CardTitle>
            <CardDescription>We sent a 6-digit code to <strong>{email}</strong>. Enter it below.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleVerifyCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="apply-code">Sign-in code</Label>
                <Input
                  id="apply-code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  autoFocus
                  className="tracking-widest"
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>
              )}
              <Button
                type="submit"
                className="w-full h-11 text-base font-semibold"
                disabled={loading || code.length !== 6}
              >
                {loading ? 'Verifying…' : 'Verify and continue'}
              </Button>
            </form>
            <button
              type="button"
              onClick={() => { setLoginMode('email'); setCode(''); setError('') }}
              className="mt-4 w-full text-center text-sm text-gray-500 hover:text-gray-800"
            >
              Use a different email
            </button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
