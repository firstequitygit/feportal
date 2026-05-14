'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function SetPasswordPage() {
  const router = useRouter()
  const supabase = createClient()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function init() {
      // 1. The Supabase client may have already auto-processed the hash on init — check first
      const { data: { user } } = await supabase.auth.getUser()
      if (user && !cancelled) { setReady(true); return }

      // 2. PKCE flow — Supabase appended ?code= to the URL
      const code = new URLSearchParams(window.location.search).get('code')
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error && !cancelled) { setReady(true); return }
      }

      // 3. Implicit flow — tokens are in the URL hash (#access_token=...&refresh_token=...)
      const hash = window.location.hash
      if (hash.includes('access_token')) {
        const params = new URLSearchParams(hash.replace('#', ''))
        const accessToken = params.get('access_token')
        const refreshToken = params.get('refresh_token')
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
          if (!error && !cancelled) { setReady(true); return }
        }
      }
    }

    // Run init and also listen for any auth events that fire during/after
    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && !cancelled) {
        setReady(true)
      }
    })

    // After 8 seconds, show a helpful message instead of spinning forever
    const timeout = setTimeout(() => { if (!cancelled) setTimedOut(true) }, 8000)

    return () => { cancelled = true; subscription.unsubscribe(); clearTimeout(timeout) }
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

    // Verify the invite session is still alive before trying to set the password.
    // If the page sat open too long, or the link was already consumed, the
    // session goes away silently and updateUser then fails with a confusing error.
    const { data: { user: currentUser } } = await supabase.auth.getUser()
    if (!currentUser) {
      setError('Your invitation link has expired. Please request a new one from your administrator.')
      setLoading(false)
      return
    }

    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      console.error('Set-password updateUser error:', error)
      setError(error.message || 'Failed to set password. Please try again or contact support.')
      setLoading(false)
      return
    }

    // Redirect to dashboard — it will route them to /loan-officer automatically
    router.push('/dashboard')
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#ffffff' }}>
        <div className="w-full py-4 px-6" style={{ backgroundColor: '#ffffff' }}>
          <Image src="/logo-symbol.png" alt="First Equity Funding" width={36} height={36} className="h-8 w-auto" />
        </div>
        <div className="flex-1 flex items-center justify-center px-4">
          {timedOut ? (
            <div className="text-center space-y-2">
              <p className="text-gray-700 font-medium">This link has expired or is no longer valid.</p>
              <p className="text-sm text-gray-500">
                Please contact <a href="mailto:info@fefunding.com" className="text-primary hover:opacity-80">info@fefunding.com</a> to request a new invitation.
              </p>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">Verifying your invitation...</p>
          )}
        </div>
      </div>
    )
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
            <CardHeader>
              <CardTitle>Welcome — set your password</CardTitle>
              <CardDescription>
                Create a password to access the First Equity Funding Online Portal.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
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
                  {loading ? 'Setting password...' : 'Set password & sign in'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
