'use client'
import { useState, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { STEPS, STEP_TITLES, TOTAL_STEPS, type ApplicationData } from '@/lib/application-fields'
import { Step1Borrower } from '../_steps/step1-borrower'
import { Step2Deal } from '../_steps/step2-deal'
import { Step3Experience } from '../_steps/step3-experience'
import { Step4Disclosures } from '../_steps/step4-disclosures'
import { Step5Payment } from '../_steps/step5-payment'
import { useAutosave } from './use-autosave'
import { SaveStatus } from "@/components/ui/save-status"

export function Wizard({ initialData, initialStep, initialToken }: {
  initialData: ApplicationData; initialStep: number; initialToken: string | null
}) {
  const [data, setData] = useState<ApplicationData>(initialData ?? {})
  const [step, setStep] = useState(initialStep || 1)
  const [token, setToken] = useState<string | null>(initialToken)
  const [submitting, setSubmitting] = useState(false)
  const [maxVisited, setMaxVisited] = useState(initialStep || 1)

  const autosaveStatus = useAutosave(token, data, step)

  useEffect(() => {
    setMaxVisited((m) => Math.max(m, step))
  }, [step])

  const set = useCallback((patch: Record<string, unknown>) => setData(d => ({ ...d, ...patch })), [])

  // Create the draft once we have the primary email (called by Step 1 on email blur).
  const ensureDraft = useCallback(async (email: string, firstName: string) => {
    if (token || !email) return
    try {
      const res = await fetch('/api/apply/draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, firstName, data }),
      })
      const j = await res.json()
      if (j.success) { setToken(j.resumeToken); toast.success('Progress saved — a resume link was emailed to you.') }
      else toast.error(j.error ?? 'Could not start application')
    } catch { toast.error('Network error — please try again') }
  }, [token, data])

  async function submit() {
    setSubmitting(true)
    try {
      const res = await fetch('/api/apply/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeToken: token }),
      })
      const j = await res.json()
      if (j.success) window.location.href = '/apply/submitted'
      else if (j.missing) toast.error(`Missing required fields: ${j.missing.slice(0, 5).join(', ')}${j.missing.length > 5 ? '…' : ''}`)
      else toast.error(j.error ?? 'Submit failed')
    } catch { toast.error('Network error — please try again') }
    finally { setSubmitting(false) }
  }

  const stepEl = [
    <Step1Borrower key={1} data={data} set={set} ensureDraft={ensureDraft} />,
    <Step2Deal key={2} data={data} set={set} />,
    <Step3Experience key={3} data={data} set={set} />,
    <Step4Disclosures key={4} data={data} set={set} />,
    <Step5Payment key={5} data={data} token={token} />,
  ][step - 1]

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-8">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex flex-wrap gap-2 text-xs">
            {STEP_TITLES.map((t, i) => {
              const isActive = i + 1 === step
              const isVisited = i + 1 <= maxVisited
              return (
                <button
                  key={t}
                  type="button"
                  disabled={!isVisited}
                  onClick={() => isVisited && setStep(i + 1)}
                  className={`rounded px-2 py-1 ${isActive ? 'bg-[#1F5D8F] text-white' : i + 1 < step ? 'bg-slate-200 cursor-pointer hover:bg-slate-300' : isVisited ? 'bg-slate-200 cursor-pointer hover:bg-slate-300' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
                >
                  {i + 1}. {t}
                </button>
              )
            })}
          </div>
          <SaveStatus status={autosaveStatus} />
        </div>
        <div className="mt-3 h-1.5 rounded bg-slate-200">
          <div className="h-1.5 rounded bg-[#1F5D8F] transition-all" style={{ width: `${(step / TOTAL_STEPS) * 100}%` }} />
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-[#1F5D8F]">{STEP_TITLES[step - 1]}</h2>
        <span className="text-sm text-slate-500">
          Step {step} of {TOTAL_STEPS} · About {STEPS[step - 1].estimateMinutes} minutes
        </span>
      </div>
      <div className="pb-20 sm:pb-0">
        {stepEl}
      </div>

      <div
        className="sticky bottom-0 -mx-4 mt-8 border-t border-slate-200 bg-white px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:px-0"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <div className="flex justify-between">
          <Button variant="outline" disabled={step === 1} onClick={() => setStep(s => Math.max(1, s - 1))}>← Back</Button>
          {step < TOTAL_STEPS
            ? <Button onClick={() => setStep(s => Math.min(TOTAL_STEPS, s + 1))}>Next →</Button>
            : <Button onClick={submit} disabled={submitting || !token}>{submitting ? 'Submitting…' : 'Submit Application'}</Button>}
        </div>
      </div>
    </div>
  )
}
