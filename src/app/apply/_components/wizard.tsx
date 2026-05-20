'use client'
import { useState, useCallback, useEffect, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { STEPS, STEP_TITLES, TOTAL_STEPS, ALL_FIELDS, getMissingRequiredFields, type ApplicationData, type StepId } from '@/lib/application-fields'
import { Step1Borrower } from '../_steps/step1-borrower'
import { Step2Deal } from '../_steps/step2-deal'
import { Step3Experience } from '../_steps/step3-experience'
import { Step4Disclosures } from '../_steps/step4-disclosures'
import { Step5Payment } from '../_steps/step5-payment'
import { useAutosave } from './use-autosave'
import { SaveStatus } from "@/components/ui/save-status"

const ROMAN = ["I", "II", "III", "IV", "V"] as const

// Resolve a prefixed field name to its current value in data.
// "primary.first_name"  -> data.primary?.first_name
// "coborrower1.ssn"     -> data.co_borrowers?.[0]?.ssn
// "purchase_price"      -> data.purchase_price
function isStillMissing(prefixedName: string, data: ApplicationData): boolean {
  const dot = prefixedName.indexOf(".")
  let v: unknown
  if (dot === -1) {
    v = (data as Record<string, unknown>)[prefixedName]
  } else {
    const ns = prefixedName.slice(0, dot)
    const field = prefixedName.slice(dot + 1)
    if (ns === "primary") {
      v = ((data as Record<string, Record<string, unknown> | undefined>).primary)?.[field]
    } else if (ns.startsWith("coborrower")) {
      const i = parseInt(ns.slice("coborrower".length), 10) - 1
      const arr = (data as { co_borrowers?: Array<Record<string, unknown>> }).co_borrowers
      v = arr?.[i]?.[field]
    }
  }
  return v === undefined || v === null || v === ""
}

export function Wizard({ initialData, initialStep, initialToken }: {
  initialData: ApplicationData; initialStep: number; initialToken: string | null
}) {
  const [data, setData] = useState<ApplicationData>(initialData ?? {})
  const [step, setStep] = useState(initialStep || 1)
  const [token, setToken] = useState<string | null>(initialToken)
  const [submitting, setSubmitting] = useState(false)
  const [maxVisited, setMaxVisited] = useState(initialStep || 1)
  const [submitErrors, setSubmitErrors] = useState<string[] | null>(null)

  const searchParams = useSearchParams()
  const devSkipRequired =
    process.env.NODE_ENV !== "production" &&
    searchParams.get("dev") === "1"

  const autosaveStatus = useAutosave(token, data, step)

  useEffect(() => {
    setMaxVisited((m) => Math.max(m, step))
  }, [step])

  const set = useCallback((patch: Record<string, unknown>) => setData(d => ({ ...d, ...patch })), [])

  // Derive live-missing: errors from the last validation attempt that are still empty.
  const liveMissing = useMemo(() => {
    if (!submitErrors) return [] as string[]
    return submitErrors.filter((n) => isStillMissing(n, data))
  }, [submitErrors, data])

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
    setSubmitErrors(null)
    try {
      const res = await fetch('/api/apply/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeToken: token }),
      })
      const j = await res.json()
      if (j.success) {
        window.location.href = '/apply/submitted'
        return
      }
      if (!res.ok && Array.isArray(j.missing) && j.missing.length > 0) {
        const missing: string[] = j.missing
        setSubmitErrors(missing)
        requestAnimationFrame(() => {
          const first = document.getElementById(`f-${missing[0]}`)
          if (first) {
            first.scrollIntoView({ behavior: 'smooth', block: 'center' })
            ;(first as HTMLElement).focus()
          }
        })
        return
      }
      toast.error(j.error ?? 'Submit failed')
    } catch { toast.error('Network error — please try again') }
    finally { setSubmitting(false) }
  }

  function goNext() {
    if (devSkipRequired) {
      setSubmitErrors(null)
      setStep(s => Math.min(TOTAL_STEPS, s + 1))
      return
    }

    const stepId = STEPS[step - 1].id as StepId
    const missing = getMissingRequiredFields(stepId, data)

    if (missing.length > 0) {
      setSubmitErrors(missing)
      requestAnimationFrame(() => {
        const el = document.getElementById(`f-${missing[0]}`)
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" })
          ;(el as HTMLElement).focus()
        }
      })
      return
    }

    setSubmitErrors(null)
    setStep(s => Math.min(TOTAL_STEPS, s + 1))
  }

  const stepEl = [
    <Step1Borrower key={1} data={data} set={set} ensureDraft={ensureDraft} missingFields={liveMissing} />,
    <Step2Deal key={2} data={data} set={set} missingFields={liveMissing} />,
    <Step3Experience key={3} data={data} set={set} missingFields={liveMissing} />,
    <Step4Disclosures key={4} data={data} set={set} missingFields={liveMissing} />,
    <Step5Payment key={5} data={data} token={token} />,
  ][step - 1]

  const roman = ROMAN[step - 1]

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      {devSkipRequired && (
        <div
          role="alert"
          className="mb-4 rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          <strong>Dev mode:</strong> required-field gating is bypassed.
          Server validation still runs on submit.
        </div>
      )}

      {/* SaveStatus — top-right above chapter nav */}
      <div className="mb-3 flex justify-end">
        <SaveStatus status={autosaveStatus} />
      </div>

      {/* Roman-numeral chapter nav */}
      <nav className="border-b border-(--apply-border) pb-4">
        <ol className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-xs uppercase tracking-[0.18em]">
          {STEP_TITLES.map((t, i) => {
            const isActive = i + 1 === step
            const isVisited = i + 1 <= maxVisited
            return (
              <li key={t} className="flex items-baseline gap-2">
                <button
                  type="button"
                  disabled={!isVisited}
                  onClick={() => isVisited && (setSubmitErrors(null), setStep(i + 1))}
                  className={[
                    "flex items-baseline gap-2 transition-colors",
                    isActive
                      ? "text-(--apply-brand)"
                      : isVisited
                        ? "text-(--apply-ink-subtle) hover:text-(--apply-brand)"
                        : "text-(--apply-ink-muted) opacity-40 cursor-not-allowed",
                  ].join(" ")}
                >
                  <span
                    className="text-base normal-case tracking-normal"
                    style={{
                      fontFamily: "var(--font-display)",
                      fontVariationSettings: "'opsz' 14, 'SOFT' 50",
                    }}
                  >
                    {ROMAN[i]}
                  </span>
                  <span className="font-medium">{t}</span>
                </button>
                {i < STEP_TITLES.length - 1 && (
                  <span className="ml-4 opacity-40 text-(--apply-ink-muted) hidden sm:inline" aria-hidden>·</span>
                )}
              </li>
            )
          })}
        </ol>
      </nav>

      {/* Chapter opening header */}
      <header className="mb-10 mt-12 grid grid-cols-[auto_1fr] items-baseline gap-x-8 gap-y-2 border-b border-(--apply-border) pb-8">
        <div
          className="text-7xl text-(--apply-brand) leading-none"
          style={{
            fontFamily: "var(--font-display)",
            fontVariationSettings: "'opsz' 144, 'SOFT' 30, 'WONK' 1",
          }}
        >
          {roman}
        </div>
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-(--apply-ink-muted) mb-2">
            Step {step} of {TOTAL_STEPS} &middot; About {STEPS[step - 1].estimateMinutes} minutes
          </div>
          <h1
            className="text-3xl text-(--apply-ink) leading-tight"
            style={{
              fontFamily: "var(--font-display)",
              fontVariationSettings: "'opsz' 36, 'SOFT' 20",
            }}
          >
            {STEP_TITLES[step - 1]}
          </h1>
        </div>
      </header>

      {/* Error banner — editorial styling */}
      {liveMissing.length > 0 && (
        <div
          role="alert"
          className="mb-8 border-l-2 border-(--apply-danger) bg-(--apply-surface) pl-6 py-4 pr-4"
        >
          <div className="text-xs uppercase tracking-[0.22em] text-(--apply-danger) mb-1">
            Attention
          </div>
          <p
            className="text-lg text-(--apply-ink) mb-2"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {liveMissing.length} {liveMissing.length === 1 ? "field needs" : "fields need"} attention
          </p>
          <ul className="space-y-1 text-sm">
            {liveMissing.slice(0, 5).map((name) => {
              const dot = name.indexOf(".")
              const rawName = dot === -1 ? name : name.slice(dot + 1)
              const field = ALL_FIELDS.find((f) => f.name === rawName)
              const label = field?.label ?? rawName
              const ns = dot === -1 ? "" : name.slice(0, dot)
              const displayPrefix = ns.startsWith("coborrower")
                ? `Co-Borrower ${ns.slice("coborrower".length)}: `
                : ""
              return (
                <li key={name}>
                  <button
                    type="button"
                    className="text-(--apply-ink-subtle) underline underline-offset-2 hover:text-(--apply-brand)"
                    onClick={() => {
                      const el = document.getElementById(`f-${name}`)
                      if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                        ;(el as HTMLElement).focus()
                      }
                    }}
                  >
                    {displayPrefix}{label}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="pb-20 sm:pb-0">
        {stepEl}
      </div>

      {/* Sticky footer */}
      <div
        className="sticky bottom-0 -mx-6 mt-8 border-t border-(--apply-border) bg-(--apply-surface) px-6 py-3 sm:static sm:mx-0 sm:border-0 sm:px-0"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-center justify-between">
          <button
            type="button"
            disabled={step === 1}
            onClick={() => { setSubmitErrors(null); setStep(s => Math.max(1, s - 1)) }}
            className="inline-flex items-center rounded-sm border border-(--apply-border-strong) px-4 py-2 text-sm text-(--apply-ink-subtle) transition-colors hover:border-(--apply-brand) hover:text-(--apply-brand) disabled:pointer-events-none disabled:opacity-40"
          >
            &larr; Back
          </button>
          <div className="flex items-center gap-6">
            {step !== TOTAL_STEPS && (
              <button
                type="button"
                className="text-xs uppercase tracking-[0.18em] text-(--apply-ink-muted) transition-colors hover:text-(--apply-brand)"
                onClick={async () => {
                  try {
                    await fetch('/api/apply/draft', {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ resumeToken: token, data, currentStep: step }),
                    })
                    toast.success('Saved. Use the link in your earlier email to resume.')
                  } catch {
                    toast.error("Couldn't save. Check your connection and try again.")
                  }
                }}
              >
                Save &amp; finish later
              </button>
            )}
            {step < TOTAL_STEPS
              ? (
                <button
                  type="button"
                  onClick={goNext}
                  className="inline-flex items-center rounded-sm bg-(--apply-brand) px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-(--apply-brand-deep) active:scale-[0.98]"
                >
                  Next &rarr;
                </button>
              )
              : (
                <button
                  type="button"
                  onClick={submit}
                  disabled={submitting || !token}
                  className="inline-flex items-center rounded-sm bg-(--apply-brand) px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-(--apply-brand-deep) active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60"
                >
                  {submitting ? 'Submitting…' : 'Submit Application'}
                </button>
              )}
          </div>
        </div>
      </div>
    </div>
  )
}
