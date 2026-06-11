'use client'
import { useState, useCallback, useEffect, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { ALL_FIELDS, getMissingRequiredFields, type ApplicationData, type StepId } from '@/lib/application-fields'
import { VARIANTS_BY_KIND, type VariantKind } from '@/lib/application/variants'
import { Step1Borrower } from '../_steps/step1-borrower'
import { Step2Deal } from '../_steps/step2-deal'
import { Step3Experience } from '../_steps/step3-experience'
import { Step4Declarations } from '../_steps/step4-declarations'
import { Step5Authorization } from '../_steps/step5-authorization'
import { Step5BrokerAttestation } from '../_steps/step5-broker-attestation'
import { useAutosave } from './use-autosave'
import { SaveStatus } from "@/components/ui/save-status"
import { TestModePanel, type TestOverridesState } from './test-mode-panel'
import { EmbedHeightReporter } from './embed-height-reporter'

// Resolve a prefixed field name to its current value in data.
// "primary.first_name"  -> data.primary?.first_name
// "coborrower1.ssn"     -> data.co_borrowers?.[0]?.ssn
// "unit1.current_rent"  -> data.units?.[0]?.current_rent
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
    } else if (ns.startsWith("unit")) {
      const i = parseInt(ns.slice("unit".length), 10) - 1
      const arr = (data as { units?: Array<Record<string, unknown>> }).units
      v = arr?.[i]?.[field]
    }
  }
  return v === undefined || v === null || v === ""
}

export function Wizard({ initialData, initialStep, initialToken, isAdmin = false, loanOfficerOptions, variantKind = 'borrower' }: {
  initialData: ApplicationData
  initialStep: number
  initialToken: string | null
  isAdmin?: boolean
  loanOfficerOptions: string[]
  variantKind?: VariantKind
}) {
  const variant = VARIANTS_BY_KIND[variantKind]
  const STEPS = variant.steps
  const TOTAL_STEPS = STEPS.length
  const STEP_TITLES = STEPS.map(s => s.title)
  const testModeKey = variant.storageKeys.testMode
  const testDataKey = variant.storageKeys.testData
  const testOverridesKey = variant.storageKeys.testOverrides
  const showTestMode = variant.features.showTestMode
  const [data, setData] = useState<ApplicationData>(initialData ?? {})
  const [step, setStep] = useState(initialStep || 1)
  const [token, setToken] = useState<string | null>(initialToken)
  const [submitting, setSubmitting] = useState(false)
  const [maxVisited, setMaxVisited] = useState(initialStep || 1)
  const [submitErrors, setSubmitErrors] = useState<string[] | null>(null)
  const [testMode, setTestMode] = useState(false)
  const [testSubmitting, setTestSubmitting] = useState(false)

  // Load + persist test mode toggle (admins only).
  useEffect(() => {
    if (!isAdmin || !showTestMode) return
    try {
      const raw = window.localStorage.getItem(testModeKey)
      if (raw === '1') setTestMode(true)
    } catch { /* ignore */ }
  }, [isAdmin, showTestMode, testModeKey])
  useEffect(() => {
    if (!isAdmin || !showTestMode) return
    try { window.localStorage.setItem(testModeKey, testMode ? '1' : '0') } catch { /* ignore */ }
  }, [testMode, isAdmin, showTestMode, testModeKey])

  // Persist current data to localStorage while test mode is on (autosave is suppressed).
  useEffect(() => {
    if (!testMode) return
    try { window.localStorage.setItem(testDataKey, JSON.stringify(data)) } catch { /* ignore */ }
  }, [data, testMode, testDataKey])
  useEffect(() => {
    if (!isAdmin || !testMode) return
    try {
      const raw = window.localStorage.getItem(testDataKey)
      if (raw) setData(JSON.parse(raw) as ApplicationData)
    } catch { /* ignore */ }
    // Intentionally only on toggle-on transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testMode])

  const searchParams = useSearchParams()
  const devSkipRequired =
    process.env.NODE_ENV !== "production" &&
    searchParams.get("dev") === "1"

  // Pre-fill loan officer from a referral link like /apply?lo=anthony-palmiotto.
  // Matches case-insensitively against the DB-driven loan officer list, ignoring
  // non-letter chars so URLs can use kebab, snake, or plain space-separated.
  useEffect(() => {
    const loParam = searchParams.get('lo')
    if (!loParam) return
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')
    const target = norm(loParam)
    const match = loanOfficerOptions.find((opt) => norm(opt) === target)
    if (!match) return
    setData((d) => {
      const cur = (d.primary as Record<string, unknown>) ?? {}
      if (cur.loan_officer_assigned) return d
      return { ...d, primary: { ...cur, loan_officer_assigned: match } }
    })
  }, [searchParams, loanOfficerOptions])

  const autosaveStatus = useAutosave(token, data, step, testMode, variant.endpoints.draftPatch)

  useEffect(() => {
    setMaxVisited((m) => Math.max(m, step))
  }, [step])

  const set = useCallback(
    (patchOrFn: Record<string, unknown> | ((d: ApplicationData) => Record<string, unknown>)) =>
      setData((d) => ({
        ...d,
        ...(typeof patchOrFn === 'function' ? patchOrFn(d) : patchOrFn),
      })),
    [],
  )

  // Derive live-missing: errors from the last validation attempt that are still empty.
  const liveMissing = useMemo(() => {
    if (!submitErrors) return [] as string[]
    return submitErrors.filter((n) => isStillMissing(n, data))
  }, [submitErrors, data])

  // Duplicate-account gate: when the borrower variant has
  // duplicateAccountBehavior='block', we check the email on first blur
  // and, if a borrowers row already exists, block draft creation and
  // show a modal directing them to /login.
  const [existingAccountEmail, setExistingAccountEmail] = useState<string | null>(null)
  const checkAccountIfNeeded = useCallback(async (email: string): Promise<boolean> => {
    if (variant.features.duplicateAccountBehavior !== 'block') return true
    if (!email || !email.includes('@')) return true
    try {
      const res = await fetch('/api/apply/check-account', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) return true
      const j = await res.json()
      if (j.hasAccount) {
        setExistingAccountEmail(email)
        return false
      }
      return true
    } catch {
      // Fail open: network blip shouldn't block a legitimate applicant.
      return true
    }
  }, [variant.features.duplicateAccountBehavior])

  // Create the draft once we have the primary email (called by Step 1 on email blur).
  const ensureDraft = useCallback(async (email: string, firstName: string) => {
    if (testMode) return
    if (token || !email) return
    const ok = await checkAccountIfNeeded(email)
    if (!ok) return
    try {
      const res = await fetch(variant.endpoints.draftPost, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, firstName, data }),
      })
      const j = await res.json()
      if (j.success) { setToken(j.resumeToken); toast.success('Progress saved. A resume link was emailed to you.') }
      else toast.error(j.error ?? 'Could not start application')
    } catch { toast.error('Network error - please try again') }
  }, [token, data, testMode, variant.endpoints.draftPost, checkAccountIfNeeded])

  async function submit() {
    setSubmitting(true)
    setSubmitErrors(null)
    try {
      const res = await fetch(variant.endpoints.submit, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeToken: token }),
      })
      const j = await res.json()
      if (j.success) {
        // Broker variant needs the freshly-minted authorize_token in the URL
        // so the confirmation page can show the forwardable /authorize link.
        const dest = variantKind === 'broker' && j.authorizeToken
          ? `${variant.redirects.afterSubmit}?token=${encodeURIComponent(j.authorizeToken)}`
          : variant.redirects.afterSubmit
        window.location.href = dest
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
    } catch { toast.error('Network error - please try again') }
    finally { setSubmitting(false) }
  }

  async function testSubmit(overrides: TestOverridesState, scenarioLabel: string, submissionData: ApplicationData) {
    setTestSubmitting(true)
    setSubmitErrors(null)
    try {
      // Inside the WordPress iframe the admin cookie isn't sent, so the API
      // can't authorize via session. If the page was opened with a ?testkey
      // secret (embed test mode), forward it as a header so the test-submit
      // route can authorize without the cookie. No-op for normal admin use.
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const embedTestKey = typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('testkey')
        : null
      if (embedTestKey) headers['x-embed-test-key'] = embedTestKey
      const res = await fetch(variant.endpoints.testSubmit, {
        method: 'POST',
        headers,
        body: JSON.stringify({ data: submissionData, overrides, scenarioLabel }),
      })
      const j = await res.json()
      if (j.success) {
        try {
          sessionStorage.setItem('fe-apply-test-result', JSON.stringify({
            scenario: j.scenario,
            recipients: j.recipients,
            pdfBytes: j.pdfBytes,
            data: submissionData,
          }))
        } catch { /* ignore */ }
        window.location.href = '/apply/test-submitted'
        return
      }
      if (!res.ok && Array.isArray(j.missing) && j.missing.length > 0) {
        setSubmitErrors(j.missing)
        toast.error(`${j.missing.length} required field${j.missing.length === 1 ? '' : 's'} missing`)
        return
      }
      toast.error(j.error ?? 'Test submit failed')
    } catch {
      toast.error('Network error - please try again')
    } finally {
      setTestSubmitting(false)
    }
  }

  function goNext() {
    if (devSkipRequired) {
      setSubmitErrors(null)
      setStep(s => Math.min(TOTAL_STEPS, s + 1))
      return
    }

    const stepId = STEPS[step - 1].id as StepId
    const missing = getMissingRequiredFields(stepId, data, { variant: variantKind })

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
    <Step1Borrower key={1} data={data} set={set} ensureDraft={ensureDraft} missingFields={liveMissing} loanOfficerOptions={loanOfficerOptions} primaryExtraFields={variant.fieldArrays.primaryExtraFields} brokerInfoFields={variant.fieldArrays.brokerInfoFields} />,
    <Step2Deal key={2} data={data} set={set} missingFields={liveMissing} token={token} testMode={testMode} />,
    <Step3Experience key={3} data={data} set={set} missingFields={liveMissing} />,
    <Step4Declarations key={4} data={data} set={set} missingFields={liveMissing} />,
    variantKind === 'broker'
      ? <Step5BrokerAttestation key={5} data={data} set={set} missingFields={liveMissing}
          onEdit={(s) => { setSubmitErrors(null); setStep(s) }}
          variantCopy={{
            step5AttestationLabel: variant.copy.step5AttestationLabel ?? 'Broker Certification',
            step5AttestationBody: variant.copy.step5AttestationBody ?? '',
          }} />
      : <Step5Authorization key={5} data={data} set={set} missingFields={liveMissing}
          token={token} testMode={testMode} onEdit={(s) => { setSubmitErrors(null); setStep(s) }} />,
  ][step - 1]

  return (
    <div className="mx-auto max-w-3xl px-6 py-5">
      <EmbedHeightReporter />
      {existingAccountEmail && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900">Looks like you have applied with us before</h2>
            <p className="mt-2 text-sm text-gray-600">
              We already have an account for <strong className="font-medium text-gray-900">{existingAccountEmail}</strong>.
              To submit a new application, please log in to your portal first so your new loan stays connected to your profile.
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Forgot your password? Use the &ldquo;Reset password&rdquo; link on the login page. If you have not set up your portal access yet,
              email <a href="mailto:processing@fefunding.com" className="underline">processing@fefunding.com</a> and we will resend your activation link.
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
              <a
                href={`/login?email=${encodeURIComponent(existingAccountEmail)}`}
                className="inline-flex h-10 items-center justify-center rounded-md bg-[#1F5D8F] px-5 text-sm font-medium text-white transition-colors hover:bg-[#0F3A5E]"
              >
                Log In to Continue
              </a>
              <button
                type="button"
                onClick={() => {
                  setExistingAccountEmail(null)
                  setData((d) => {
                    const cur = (d.primary as Record<string, unknown>) ?? {}
                    return { ...d, primary: { ...cur, email: '' } }
                  })
                }}
                className="inline-flex h-10 items-center justify-center rounded-md border border-gray-300 px-5 text-sm text-gray-700 transition-colors hover:border-gray-400"
              >
                Use a different email
              </button>
            </div>
          </div>
        </div>
      )}
      {isAdmin && showTestMode && (
        <div className="mb-3 flex items-center justify-end gap-2">
          <span className="text-xs font-medium text-gray-500">Test mode</span>
          <button
            type="button"
            role="switch"
            aria-checked={testMode}
            onClick={() => setTestMode(t => !t)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${testMode ? 'bg-amber-600' : 'bg-gray-300'}`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${testMode ? 'translate-x-5' : 'translate-x-1'}`}
            />
          </button>
        </div>
      )}

      {testMode && (
        <div role="alert" className="mb-4 rounded-md border-2 border-amber-400 bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-900">
          TEST MODE - submissions will not be saved to live records.
        </div>
      )}

      {testMode && (
        <TestModePanel
          data={data}
          setData={(next) => setData(next)}
          step={step}
          setStep={(n) => { setSubmitErrors(null); setStep(n); setMaxVisited(m => Math.max(m, n)) }}
          onAutoSubmit={(overrides, label, scenarioData) => testSubmit(overrides, label, scenarioData)}
          busy={testSubmitting}
          overridesStorageKey={testOverridesKey}
          variantKind={variantKind}
        />
      )}

      {devSkipRequired && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          <strong>Dev mode:</strong> required-field gating is bypassed.
          Server validation still runs on submit.
        </div>
      )}

      {/* SaveStatus - top-right above stepper */}
      <div className="mb-3 flex justify-end">
        <SaveStatus status={autosaveStatus} />
      </div>

      {/* Horizontal numbered-circle stepper */}
      <nav aria-label="Application progress" className="mb-5">
        <ol className="flex items-start justify-between">
          {STEP_TITLES.map((title, i) => {
            const n = i + 1
            const isActive = n === step
            const isComplete = n < step
            const isVisited = n <= maxVisited
            const isLast = i === STEP_TITLES.length - 1
            return (
              <li key={title} className="relative flex-1 flex flex-col items-center">
                {/* connecting line to next step */}
                {!isLast && (
                  <div
                    aria-hidden
                    className={`absolute top-4 left-1/2 right-[-50%] h-px ${
                      isComplete ? 'bg-[#1F5D8F]' : 'bg-gray-200'
                    }`}
                  />
                )}
                {/* circle */}
                <button
                  type="button"
                  disabled={!isVisited}
                  onClick={() => {
                    if (isVisited) {
                      setSubmitErrors(null)
                      setStep(n)
                    }
                  }}
                  className={[
                    'relative z-10 flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold transition-colors',
                    isActive
                      ? 'border-[#1F5D8F] bg-[#1F5D8F] text-white ring-4 ring-[#1F5D8F]/15'
                      : isComplete
                        ? 'border-[#1F5D8F] bg-[#1F5D8F] text-white hover:bg-[#0F3A5E]'
                        : isVisited
                          ? 'border-gray-300 bg-white text-gray-500 hover:border-gray-400'
                          : 'border-gray-200 bg-white text-gray-400 cursor-not-allowed',
                  ].join(' ')}
                >
                  {isComplete ? (
                    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path d="M3.5 8L6.5 11L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : n}
                </button>
                {/* label */}
                <span
                  className={`mt-2 text-xs font-medium text-center leading-tight ${
                    isActive ? 'text-[#1F5D8F]' : 'text-gray-500'
                  }`}
                >
                  {title}
                </span>
              </li>
            )
          })}
        </ol>
      </nav>

      {/* Form card */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="p-4 sm:p-5">
          {/* Step heading */}
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-gray-900">{STEPS[step - 1].title}</h2>
            <p className="mt-0.5 text-sm text-gray-500">{STEPS[step - 1].subtitle}</p>
            <p className="mt-0.5 text-xs text-gray-400">
              Step {step} of {TOTAL_STEPS} &middot; About {STEPS[step - 1].estimateMinutes} minutes &middot;{' '}
              <span className="text-red-500" aria-hidden="true">*</span> indicates a required field
            </p>
          </div>

          {/* Error banner - standard alert */}
          {liveMissing.length > 0 && (
            <div role="alert" className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm">
              <p className="font-medium text-red-800">
                {liveMissing.length} {liveMissing.length === 1 ? 'field needs' : 'fields need'} attention
              </p>
              <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto pr-1 text-red-700">
                {liveMissing.map((name) => {
                  const dot = name.indexOf(".")
                  const rawName = dot === -1 ? name : name.slice(dot + 1)
                  const field = ALL_FIELDS.find((f) => f.name === rawName)
                  const label = field?.label ?? rawName
                  const ns = dot === -1 ? "" : name.slice(0, dot)
                  const displayPrefix = ns.startsWith("coborrower")
                    ? `Co-Borrower ${ns.slice("coborrower".length)}: `
                    : ns.startsWith("unit")
                      ? `Unit ${ns.slice("unit".length)}: `
                      : ""
                  return (
                    <li key={name}>
                      <button
                        type="button"
                        className="underline underline-offset-2 hover:text-red-900"
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
        </div>
      </div>

      {/* Step counter below the card */}
      <p className="mt-4 text-center text-xs text-gray-400">
        Step {step} of {TOTAL_STEPS}
      </p>

      {/* Sticky footer */}
      <div
        className="sticky bottom-0 -mx-6 mt-6 px-6 py-3 sm:static sm:mx-0 sm:px-0"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-center justify-between">
          <button
            type="button"
            disabled={step === 1}
            onClick={() => { setSubmitErrors(null); setStep(s => Math.max(1, s - 1)) }}
            className="inline-flex items-center rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 transition-colors hover:border-[#1F5D8F] hover:text-[#1F5D8F] disabled:pointer-events-none disabled:opacity-40"
          >
            &larr; Back
          </button>
          <div className="flex items-center gap-6">
            {step !== TOTAL_STEPS && !testMode && (
              <button
                type="button"
                className="text-sm text-gray-600 underline hover:text-gray-900"
                onClick={async () => {
                  try {
                    await fetch(variant.endpoints.draftPatch, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ resumeToken: token, data, currentStep: step }),
                    })
                    toast.success(variant.copy.saveAndFinishLaterToast)
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
                  className="inline-flex h-11 items-center rounded-md bg-[#1F5D8F] px-6 text-base font-semibold text-white transition-colors hover:bg-[#0F3A5E] active:scale-[0.98]"
                >
                  Continue to {STEPS[step].title} &rarr;
                </button>
              )
              : (
                <button
                  type="button"
                  onClick={async () => {
                    if (testMode) {
                      const overridesRaw = (() => {
                        try { return JSON.parse(window.localStorage.getItem(testOverridesKey) ?? 'null') } catch { return null }
                      })() as TestOverridesState | null
                      const overrides: TestOverridesState = overridesRaw ?? {
                        borrowerEmail: 'apalmiotto@outlook.com',
                        processingInbox: 'apalmiotto@outlook.com',
                        loEmail: 'apalmiotto@outlook.com',
                      }
                      await testSubmit(overrides, 'Manual submit', data)
                    } else {
                      submit()
                    }
                  }}
                  disabled={testMode ? testSubmitting : (submitting || !token)}
                  className="inline-flex h-11 items-center rounded-md bg-[#1F5D8F] px-6 text-base font-semibold text-white transition-colors hover:bg-[#0F3A5E] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60"
                >
                  {testMode ? (testSubmitting ? 'Submitting…' : 'Submit Test Application') : (submitting ? 'Submitting…' : variant.copy.submitButtonLabel)}
                </button>
              )}
          </div>
        </div>
      </div>
    </div>
  )
}
