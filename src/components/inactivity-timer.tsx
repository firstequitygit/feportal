'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const TIMEOUT_MS = 30 * 60 * 1000       // 30 minutes
const WARNING_MS = 28 * 60 * 1000       // warn at 28 minutes (2 min before)
const EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click']

export function InactivityTimer() {
  const router = useRouter()
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const warningRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showWarning, setShowWarning] = useState(false)

  function clearTimers() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (warningRef.current) clearTimeout(warningRef.current)
  }

  function resetTimer() {
    clearTimers()
    setShowWarning(false)

    warningRef.current = setTimeout(() => {
      setShowWarning(true)
    }, WARNING_MS)

    timeoutRef.current = setTimeout(async () => {
      setShowWarning(false)
      const supabase = createClient()
      await supabase.auth.signOut()
      router.push('/login')
    }, TIMEOUT_MS)
  }

  useEffect(() => {
    resetTimer()
    EVENTS.forEach(e => window.addEventListener(e, resetTimer, { passive: true }))
    return () => {
      clearTimers()
      EVENTS.forEach(e => window.removeEventListener(e, resetTimer))
    }
  }, [])

  if (!showWarning) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 text-center">
        <p className="text-2xl mb-2">⏱</p>
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Still there?</h2>
        <p className="text-sm text-gray-500 mb-5">
          You'll be signed out in 2 minutes due to inactivity.
        </p>
        <button
          onClick={resetTimer}
          className="w-full bg-primary text-white py-2 px-4 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Stay signed in
        </button>
      </div>
    </div>
  )
}
