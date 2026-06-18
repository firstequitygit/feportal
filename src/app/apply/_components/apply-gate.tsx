'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
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
    // We always advance to the code screen to avoid email enumeration.
    try {
      await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/apply`,
        },
      })
    } finally {
      setLoading(false)
    }
    setLoginMode('code')
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
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900">Apply for a loan</h1>
          <p className="mt-1 text-sm text-gray-500">Let us know if you have worked with us before.</p>
          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setView('new')}
              className="inline-flex h-12 items-center justify-center rounded-md bg-[#1F5D8F] px-5 text-base font-semibold text-white transition-colors hover:bg-[#0F3A5E]"
            >
              I am a new borrower
            </button>
            <button
              type="button"
              onClick={() => { setView('login'); setLoginMode('email'); setError('') }}
              className="inline-flex h-12 items-center justify-center rounded-md border border-gray-300 px-5 text-base font-medium text-gray-700 transition-colors hover:border-[#1F5D8F] hover:text-[#1F5D8F]"
            >
              I am a returning customer
            </button>
          </div>
          <p className="mt-4 text-center text-xs text-gray-400">
            Returning customers sign in so we can pre-fill your saved information.
          </p>
        </div>
      )}

      {view === 'login' && loginMode === 'email' && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900">Welcome back</h1>
          <p className="mt-1 text-sm text-gray-500">Enter your email and we will send you a sign-in code.</p>
          <form onSubmit={handleSendCode} className="mt-5 space-y-4">
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 w-full rounded-md border border-gray-300 px-3 text-sm outline-none focus:border-[#1F5D8F]"
            />
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-11 w-full items-center justify-center rounded-md bg-[#1F5D8F] px-5 text-base font-semibold text-white transition-colors hover:bg-[#0F3A5E] disabled:opacity-60"
            >
              {loading ? 'Sending…' : 'Send sign-in code'}
            </button>
          </form>
          <button
            type="button"
            onClick={() => { setView('choose'); setError('') }}
            className="mt-4 w-full text-center text-sm text-gray-500 hover:text-gray-800"
          >
            ← I am actually a new borrower
          </button>
        </div>
      )}

      {view === 'login' && loginMode === 'code' && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900">Check your email</h1>
          <p className="mt-1 text-sm text-gray-500">We sent a 6-digit code to <strong>{email}</strong>. Enter it below.</p>
          <form onSubmit={handleVerifyCode} className="mt-5 space-y-4">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              autoFocus
              className="h-11 w-full rounded-md border border-gray-300 px-3 text-sm tracking-widest outline-none focus:border-[#1F5D8F]"
            />
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="inline-flex h-11 w-full items-center justify-center rounded-md bg-[#1F5D8F] px-5 text-base font-semibold text-white transition-colors hover:bg-[#0F3A5E] disabled:opacity-60"
            >
              {loading ? 'Verifying…' : 'Verify and continue'}
            </button>
          </form>
          <button
            type="button"
            onClick={() => { setLoginMode('email'); setCode(''); setError('') }}
            className="mt-4 w-full text-center text-sm text-gray-500 hover:text-gray-800"
          >
            Use a different email
          </button>
        </div>
      )}
    </div>
  )
}
