'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

export type AutosaveStatus =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved'; at: number }
  | { state: 'error'; message: string }

/** Debounced PATCH to /api/apply/draft. No-op until a resumeToken exists. */
export function useAutosave(resumeToken: string | null, data: unknown, currentStep: number): AutosaveStatus {
  const [status, setStatus] = useState<AutosaveStatus>({ state: 'idle' })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const save = useCallback(async (token: string) => {
    setStatus({ state: 'saving' })
    try {
      const res = await fetch('/api/apply/draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeToken: token, data, currentStep }),
      })
      if (res.ok) {
        setStatus({ state: 'saved', at: Date.now() })
      } else {
        setStatus({ state: 'error', message: `HTTP ${res.status}` })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed'
      setStatus({ state: 'error', message })
    }
  }, [data, currentStep])

  useEffect(() => {
    if (!resumeToken) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      save(resumeToken)
    }, 1500)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [resumeToken, save])

  return status
}
