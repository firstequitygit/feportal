'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function WelcomePage() {
  const router = useRouter()
  const supabase = createClient()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [ready, setReady] = useState(false)
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    let cancelled = false

    function markReady(user: { user_metadata?: { full_name?: string } } | null | undefined) {
      if (cancelled) return
      setReady(true)
      setName(user?.user_metadata?.full_name ?? '')
    }

    async function init() {
      // 1. The Supabase client may have already auto-processed the hash on init
      const { data: { user } } = await supabase.auth.getUser()
      if (user) { markReady(user); return }

      // 2. PKCE flow — Supabase appended ?code= to the URL
      const code = new URLSearchParams(window.location.search).get('code')
      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error) { markReady(data.user); return }
      }

      // 3. Implicit flow — tokens are in the URL hash (#access_token=...)
      const hash = window.location.hash
      if (hash.includes('access_token')) {
        const params = new URLSearchParams(hash.replace('#', ''))
        const accessToken = params.get('access_token')
        const refreshToken = params.get('refresh_token')
        if (accessToken && refreshToken) {
          const { data, error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
          if (!error) { markReady(data.user); return }
        }
      }
    }

    init()

    // Belt and suspenders: if any auth event fires during/after init, accept it
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        markReady(session?.user)
      }
    })

    const timeout = setTimeout(() => { if (!cancelled) setTimedOut(true) }, 8000)

    return () => {
      cancelled = true
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [supabase])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setError('Something went wrong. Your invite link may have expired — contact your loan officer for a new one.')
      setLoading(false)
      return
    }

    // Redirect to dashboard — the SSR client will pick up the session via cookies
    router.push('/dashboard')
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <Image src="/logo-main.png" alt="First Equity Funding" width={724} height={86} className="h-20 w-auto mx-auto" />
          </div>
          <Card>
            <CardContent className="pt-6 text-center space-y-3">
              {timedOut ? (
                <>
                  <p className="text-red-600 font-medium">This invite link has expired or is invalid.</p>
                  <p className="text-sm text-gray-500">Contact your loan officer for a new invitation.</p>
                  <a href="/login" className="text-sm text-primary hover:opacity-80 block">← Back to sign in</a>
                </>
              ) : (
                <p className="text-gray-500 text-sm">Verifying your invite link...</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Image src="/logo-main.png" alt="First Equity Funding" width={724} height={86} className="h-20 w-auto mx-auto" />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Welcome{name ? `, ${name.split(' ')[0]}` : ''}!</CardTitle>
            <CardDescription>
              You&apos;ve been invited to the First Equity Funding Online Portal.
              Set a password to access your loans.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Create a password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Minimum 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm"
                  type="password"
                  placeholder="Re-enter your password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>
              {error && (
                <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Setting up your account...' : 'Set password & view my loans'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
