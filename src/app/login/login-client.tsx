'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const RESEND_COOLDOWN_SEC = 60
const SHOW_PASSWORD_FALLBACK_UNTIL = new Date('2026-06-19') // 30 days from 2026-05-20 launch

type Mode = 'email' | 'code' | 'password'

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return email
  if (local.length <= 2) return `${local[0]}••@${domain}`
  return `${local[0]}${'•'.repeat(Math.max(2, local.length - 2))}${local.slice(-1)}@${domain}`
}

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()

  const [mode, setMode] = useState<Mode>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const showPasswordFallback = new Date() < SHOW_PASSWORD_FALLBACK_UNTIL

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN_SEC)
    if (cooldownTimer.current) clearInterval(cooldownTimer.current)
    cooldownTimer.current = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1 && cooldownTimer.current) {
          clearInterval(cooldownTimer.current)
          cooldownTimer.current = null
        }
        return Math.max(0, s - 1)
      })
    }, 1000)
  }

  useEffect(() => {
    return () => {
      if (cooldownTimer.current) clearInterval(cooldownTimer.current)
    }
  }, [])

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    // signInWithOtp sends the email via Supabase's configured SMTP (Resend).
    // shouldCreateUser: false prevents drive-by account creation by unknown emails.
    // Errors are swallowed: we always advance to the code screen to avoid enumeration.
    try {
      await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
        },
      })
    } finally {
      setLoading(false)
    }
    setMode('code')
    startCooldown()
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    // OTP codes from signInWithOtp are verified with type='email'.
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

    router.push('/dashboard')
    router.refresh()
  }

  async function handleResend() {
    if (cooldown > 0) return
    await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    })
    startCooldown()
  }

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })

    if (signInError) {
      setError('Invalid email or password. Please try again.')
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#ffffff' }}>
      <div className="w-full py-4 px-6" style={{ backgroundColor: '#ffffff' }}>
        <Image src="/logo-symbol.png" alt="First Equity Funding" width={36} height={36} className="h-8 w-auto" />
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <Image src="/logo-main.png" alt="First Equity Funding" width={724} height={86} className="h-20 w-auto mx-auto mb-3" />
          </div>

          <Card>
            {mode === 'email' && (
              <>
                <CardHeader>
                  <CardTitle>Sign in to your account</CardTitle>
                  <CardDescription>Enter your email and we&apos;ll send you a sign-in code.</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSendCode} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="email">Email address</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoComplete="email"
                      />
                    </div>
                    {error && (
                      <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>
                    )}
                    <Button type="submit" className="w-full" disabled={loading}>
                      {loading ? 'Sending…' : 'Send sign-in code'}
                    </Button>
                  </form>

                  {showPasswordFallback && (
                    <div className="text-center mt-4">
                      <button
                        type="button"
                        onClick={() => { setMode('password'); setError('') }}
                        className="text-sm text-primary hover:opacity-80"
                      >
                        Use password instead
                      </button>
                    </div>
                  )}

                  <p className="text-sm text-gray-500 text-center mt-4">
                    Need access? Contact your loan officer to receive an invitation.
                  </p>
                </CardContent>
              </>
            )}

            {mode === 'code' && (
              <>
                <CardHeader>
                  <CardTitle>Check your email</CardTitle>
                  <CardDescription>
                    We sent a 6-digit code to <strong>{maskEmail(email)}</strong>. Enter it below or click the link in the email.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleVerifyCode} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="code">Sign-in code</Label>
                      <Input
                        id="code"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        autoComplete="one-time-code"
                        placeholder="123456"
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        required
                        autoFocus
                      />
                    </div>
                    {error && (
                      <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>
                    )}
                    <Button type="submit" className="w-full" disabled={loading || code.length !== 6}>
                      {loading ? 'Verifying…' : 'Verify'}
                    </Button>
                  </form>

                  <div className="text-center mt-4 space-y-1">
                    <button
                      type="button"
                      onClick={handleResend}
                      disabled={cooldown > 0}
                      className="text-sm text-primary hover:opacity-80 disabled:opacity-50"
                    >
                      {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
                    </button>
                    <div>
                      <button
                        type="button"
                        onClick={() => { setMode('email'); setCode(''); setError('') }}
                        className="text-sm text-gray-500 hover:opacity-80"
                      >
                        Use a different email
                      </button>
                    </div>
                  </div>
                </CardContent>
              </>
            )}

            {mode === 'password' && (
              <>
                <CardHeader>
                  <CardTitle>Sign in with password</CardTitle>
                  <CardDescription>You can use your existing password to sign in.</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handlePasswordLogin} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="email-pw">Email address</Label>
                      <Input
                        id="email-pw"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoComplete="email"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="password">Password</Label>
                      <Input
                        id="password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        autoComplete="current-password"
                      />
                    </div>
                    {error && (
                      <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>
                    )}
                    <Button type="submit" className="w-full" disabled={loading}>
                      {loading ? 'Signing in…' : 'Sign in'}
                    </Button>
                  </form>

                  <div className="text-center mt-4 space-y-1">
                    <button
                      type="button"
                      onClick={() => { setMode('email'); setError('') }}
                      className="text-sm text-primary hover:opacity-80"
                    >
                      ← Use a sign-in code instead
                    </button>
                    <div>
                      <a href="/auth/forgot-password" className="text-sm text-gray-500 hover:opacity-80">
                        Forgot your password?
                      </a>
                    </div>
                  </div>
                </CardContent>
              </>
            )}
          </Card>

          {/* Iron Gate Portals marketing — prospects who land on this login
              page can reach out for their own white-labeled portal. */}
          <p className="text-xs text-gray-500 text-center mt-6">
            Looking for your own customized client portal? Contact us at{' '}
            <a
              href="mailto:info@irongateportals.com"
              className="text-primary hover:opacity-80"
            >
              info@irongateportals.com
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
