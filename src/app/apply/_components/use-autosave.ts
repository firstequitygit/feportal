'use client'
import { useEffect, useRef } from 'react'

/** Debounced PATCH to /api/apply/draft. No-op until a resumeToken exists. */
export function useAutosave(resumeToken: string | null, data: unknown, currentStep: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!resumeToken) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      fetch('/api/apply/draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeToken, data, currentStep }),
      }).catch(() => {})
    }, 1500)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [resumeToken, data, currentStep])
}
