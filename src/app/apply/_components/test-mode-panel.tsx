'use client'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { SCENARIO_OPTIONS, buildScenario, applyBrokerOverlay, type ScenarioKey } from '@/lib/test-data/scenarios'
import { TOTAL_STEPS, type ApplicationData } from '@/lib/application-fields'

const DEFAULT_EMAIL = 'apalmiotto@outlook.com'

export interface TestOverridesState {
  borrowerEmail: string
  processingInbox: string
  loEmail: string
}

const DEFAULT_OVERRIDES: TestOverridesState = {
  borrowerEmail: DEFAULT_EMAIL,
  processingInbox: DEFAULT_EMAIL,
  loEmail: DEFAULT_EMAIL,
}

function loadOverrides(key: string): TestOverridesState {
  if (typeof window === 'undefined') return DEFAULT_OVERRIDES
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return DEFAULT_OVERRIDES
    const parsed = JSON.parse(raw) as Partial<TestOverridesState>
    return {
      borrowerEmail: parsed.borrowerEmail ?? DEFAULT_EMAIL,
      processingInbox: parsed.processingInbox ?? DEFAULT_EMAIL,
      loEmail: parsed.loEmail ?? DEFAULT_EMAIL,
    }
  } catch {
    return DEFAULT_OVERRIDES
  }
}

export function TestModePanel(props: {
  data: ApplicationData
  setData: (next: ApplicationData) => void
  step: number
  setStep: (n: number) => void
  onAutoSubmit: (overrides: TestOverridesState, scenarioLabel: string, scenarioData: ApplicationData) => Promise<void>
  busy: boolean
  overridesStorageKey?: string
  /** When 'broker', scenarios get a broker identity overlay + broker_attestation_signature. */
  variantKind?: 'borrower' | 'broker'
}) {
  const { data, setData, step, setStep, onAutoSubmit, busy, overridesStorageKey = 'fe-apply-test-overrides', variantKind = 'borrower' } = props
  const buildForVariant = (key: ScenarioKey): ApplicationData => {
    const base = buildScenario(key)
    return variantKind === 'broker' ? applyBrokerOverlay(base) : base
  }
  const [scenario, setScenario] = useState<ScenarioKey>('fix-flip-purchase')
  const [overrides, setOverrides] = useState<TestOverridesState>(DEFAULT_OVERRIDES)

  useEffect(() => { setOverrides(loadOverrides(overridesStorageKey)) }, [overridesStorageKey])

  function persist(next: TestOverridesState) {
    setOverrides(next)
    try { window.localStorage.setItem(overridesStorageKey, JSON.stringify(next)) } catch { /* ignore */ }
  }

  function scenarioLabel(): string {
    return SCENARIO_OPTIONS.find(s => s.key === scenario)?.label ?? scenario
  }

  function fillWithScenario() {
    const built = buildForVariant(scenario)
    setData(built)
    toast.success(`Filled with ${scenarioLabel()}`)
  }

  async function previewPdf() {
    try {
      // Inside the WordPress iframe the admin cookie isn't sent. If the page
      // was opened with a ?testkey secret, forward it so the route can
      // authorize without the cookie. No-op for normal admin use.
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const embedTestKey = typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('testkey')
        : null
      if (embedTestKey) headers['x-embed-test-key'] = embedTestKey
      const res = await fetch('/api/apply/test-pdf', {
        method: 'POST',
        headers,
        body: JSON.stringify({ data }),
      })
      if (!res.ok) { toast.error('PDF preview failed'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'test-application.pdf'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('PDF preview failed')
    }
  }

  async function autoSubmit() {
    const built = buildForVariant(scenario)
    setData(built)
    await onAutoSubmit(overrides, scenarioLabel(), built)
  }

  return (
    <div className="mb-6 rounded-md border-2 border-amber-300 bg-amber-50 p-4 text-sm">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-semibold text-amber-900">Test mode controls</p>
        <p className="text-xs text-amber-800">Admin only - no live writes</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-amber-900">Scenario</span>
          <select
            value={scenario}
            onChange={(e) => setScenario(e.target.value as ScenarioKey)}
            className="rounded-md border border-amber-300 bg-white px-2 py-1 text-sm"
          >
            {SCENARIO_OPTIONS.map(o => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-amber-900">Skip to step</span>
          <div className="flex gap-1">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map(n => (
              <button
                key={n}
                type="button"
                onClick={() => setStep(n)}
                className={`h-8 w-8 rounded-md text-xs font-semibold ${
                  step === n
                    ? 'bg-[#1F5D8F] text-white'
                    : 'border border-amber-300 bg-white text-amber-900 hover:bg-amber-100'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-amber-900">Borrower email</span>
          <input
            type="email"
            value={overrides.borrowerEmail}
            onChange={(e) => persist({ ...overrides, borrowerEmail: e.target.value })}
            className="rounded-md border border-amber-300 bg-white px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-amber-900">Processing inbox</span>
          <input
            type="email"
            value={overrides.processingInbox}
            onChange={(e) => persist({ ...overrides, processingInbox: e.target.value })}
            className="rounded-md border border-amber-300 bg-white px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-xs font-medium text-amber-900">Loan officer email</span>
          <input
            type="email"
            value={overrides.loEmail}
            onChange={(e) => persist({ ...overrides, loEmail: e.target.value })}
            className="rounded-md border border-amber-300 bg-white px-2 py-1 text-sm"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={fillWithScenario}
          disabled={busy}
          className="inline-flex h-9 items-center rounded-md bg-amber-600 px-3 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
        >
          Fill with test data
        </button>
        <button
          type="button"
          onClick={previewPdf}
          disabled={busy}
          className="inline-flex h-9 items-center rounded-md border border-amber-600 bg-white px-3 text-sm font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
        >
          PDF preview
        </button>
        <button
          type="button"
          onClick={autoSubmit}
          disabled={busy}
          className="inline-flex h-9 items-center rounded-md bg-[#1F5D8F] px-3 text-sm font-semibold text-white hover:bg-[#0F3A5E] disabled:opacity-50"
        >
          Auto-submit
        </button>
      </div>
    </div>
  )
}
