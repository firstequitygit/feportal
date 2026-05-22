'use client'
import {
  BORROWER_FIELDS, PRIMARY_EXTRA_FIELDS, DEAL_FIELDS, UNIT_FIELDS, EXPERIENCE_FIELDS,
  DECLARATION_FIELDS, HMDA_FIELDS, STEPS,
  dscrUnitCount, isVisible,
  type ApplicationData, type FieldDef,
} from "@/lib/application-fields"

// ---- Value formatting helpers ----

function formatYesNo(v: unknown): string | null {
  if (v === true) return 'Yes'
  if (v === false) return 'No'
  return null
}

function formatCurrency(v: unknown): string | null {
  const n = typeof v === 'string' ? parseFloat(v.replace(/,/g, '')) : typeof v === 'number' ? v : NaN
  if (isNaN(n)) return null
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function maskSSN(v: unknown): string | null {
  const s = String(v ?? '').replace(/\D/g, '')
  if (s.length < 9) return null
  return `XXX-XX-${s.slice(-4)}`
}

function formatValue(f: FieldDef, v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null
  if (f.type === 'yesno') return formatYesNo(v)
  if (f.type === 'currency') return formatCurrency(v)
  if (f.type === 'ssn') return maskSSN(v)
  const s = String(v)
  if (s.trim() === '') return null
  return s
}

// ---- Section group rendering ----

interface SectionGroup {
  heading: string
  editStep: number
  rows: { label: string; value: string }[]
}

function collectRows(
  fields: FieldDef[],
  data: ApplicationData,
  scope: Record<string, unknown>,
): { label: string; value: string }[] {
  return fields
    .filter(f => isVisible(f, data, scope))
    .flatMap(f => {
      const raw = scope[f.name]
      const val = formatValue(f, raw)
      if (!val) return []
      return [{ label: f.label, value: val }]
    })
}

// ---- Main component ----

export function ReviewSummary({ data, onEdit }: {
  data: ApplicationData
  onEdit: (step: number) => void
}) {
  const primary = (data.primary as Record<string, unknown>) ?? {}
  const cobs: Record<string, unknown>[] = Array.isArray(data.co_borrowers)
    ? (data.co_borrowers as Record<string, unknown>[])
    : []

  // Build section groups
  const groups: SectionGroup[] = []

  // Step 1 - primary borrower
  const primaryRows = collectRows([...BORROWER_FIELDS, ...PRIMARY_EXTRA_FIELDS], data, primary)
  if (primaryRows.length > 0) {
    const firstName = (primary.first_name as string) || 'Primary Borrower'
    const lastName = (primary.last_name as string) || ''
    groups.push({
      heading: `${firstName}${lastName ? ' ' + lastName : ''} (Primary Borrower)`,
      editStep: 1,
      rows: primaryRows,
    })
  }

  // Step 1 - co-borrowers
  for (let i = 0; i < cobs.length; i++) {
    const scope = cobs[i]
    const rows = collectRows(BORROWER_FIELDS, data, scope)
    if (rows.length > 0) {
      const fn = (scope.first_name as string) || `Co-Borrower ${i + 1}`
      const ln = (scope.last_name as string) || ''
      groups.push({
        heading: `${fn}${ln ? ' ' + ln : ''} (Co-Borrower ${i + 1})`,
        editStep: 1,
        rows,
      })
    }
  }

  // Step 2 - deal info (root scope)
  const dealRows = collectRows(DEAL_FIELDS, data, data as Record<string, unknown>)
  if (dealRows.length > 0) {
    groups.push({ heading: STEPS[1].title, editStep: 2, rows: dealRows })
  }

  // Step 2 - per-unit rental data (DSCR loans only)
  const unitCount = dscrUnitCount(data)
  if (unitCount > 0) {
    const units = Array.isArray(data.units) ? (data.units as Record<string, unknown>[]) : []
    for (let i = 0; i < unitCount; i++) {
      const scope = units[i] ?? {}
      const unitRows = collectRows(UNIT_FIELDS, data, scope)
      if (unitRows.length > 0) {
        const heading = unitCount === 1 ? 'Rental income' : `Unit ${i + 1}`
        groups.push({ heading, editStep: 2, rows: unitRows })
      }
    }
  }

  // Step 3 - experience (root scope)
  const expRows = collectRows(EXPERIENCE_FIELDS, data, data as Record<string, unknown>)
  if (expRows.length > 0) {
    groups.push({ heading: STEPS[2].title, editStep: 3, rows: expRows })
  }

  // Step 4 - declarations + HMDA (root scope)
  const declRows = collectRows([...DECLARATION_FIELDS, ...HMDA_FIELDS], data, data as Record<string, unknown>)
  if (declRows.length > 0) {
    groups.push({ heading: STEPS[3].title, editStep: 4, rows: declRows })
  }

  if (groups.length === 0) return null

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-gray-900">Review your application</h3>
        <p className="mt-1 text-sm text-gray-500">
          Please confirm everything is correct before you sign and submit.
        </p>
      </div>

      {groups.map((g, gi) => (
        <div key={gi} className="rounded-lg border border-gray-200 bg-white">
          {/* Group header */}
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <h4 className="text-sm font-semibold text-gray-800">{g.heading}</h4>
            <button
              type="button"
              onClick={() => onEdit(g.editStep)}
              className="text-xs font-medium text-[#1F5D8F] hover:underline focus:outline-none"
            >
              Edit
            </button>
          </div>

          {/* Rows */}
          <dl className="divide-y divide-gray-100">
            {g.rows.map((row, ri) => (
              <div key={ri} className="flex items-baseline gap-3 px-4 py-2">
                <dt className="w-40 shrink-0 text-xs text-gray-500">{row.label}</dt>
                <dd className="min-w-0 flex-1 text-xs font-medium text-gray-900 break-words">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}

      <hr className="border-gray-200" />
    </div>
  )
}
