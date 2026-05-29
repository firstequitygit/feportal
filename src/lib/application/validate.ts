import {
  BORROWER_FIELDS, PRIMARY_EXTRA_FIELDS, DEAL_FIELDS, UNIT_FIELDS,
  DECLARATION_FIELDS, HMDA_FIELDS,
  dscrUnitCount, isRequired,
  type ApplicationData, type FieldDef, type FieldContext,
} from '@/lib/application-fields'

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return true
  if (Array.isArray(v) && v.length === 0) return true
  return false
}

export type ValidationContext = FieldContext

const DEFAULT_CTX: ValidationContext = { variant: 'borrower' }

/** Server-side full-application validation. Returns a list of dotted paths
 *  identifying every required-but-empty field. Empty array = ready to submit. */
export function missingRequired(
  data: ApplicationData,
  ctx: ValidationContext = DEFAULT_CTX,
): string[] {
  const miss: string[] = []
  const primary = (data.primary as Record<string, unknown>) ?? {}

  const checkScoped = (fields: FieldDef[], scope: ApplicationData, prefix: string) => {
    for (const f of fields) {
      if (isRequired(f, data, scope, ctx) && isEmpty(scope[f.name])) {
        miss.push(prefix ? `${prefix}.${f.name}` : f.name)
      }
    }
  }

  // Primary: BORROWER_FIELDS + PRIMARY_EXTRA_FIELDS
  checkScoped([...BORROWER_FIELDS, ...PRIMARY_EXTRA_FIELDS], primary as ApplicationData, 'primary')

  // Deal fields at root.
  checkScoped(DEAL_FIELDS, data, '')

  // Per-unit rental fields (DSCR loans only)
  const unitCount = dscrUnitCount(data)
  if (unitCount > 0) {
    const units = Array.isArray(data.units) ? (data.units as Record<string, unknown>[]) : []
    for (let i = 0; i < unitCount; i++) {
      const scope = (units[i] ?? {}) as ApplicationData
      checkScoped(UNIT_FIELDS, scope, `unit${i + 1}`)
    }
  }

  // Co-borrowers: BORROWER_FIELDS only.
  const cobs: Record<string, unknown>[] = Array.isArray(data.co_borrowers)
    ? (data.co_borrowers as Record<string, unknown>[])
    : []
  for (let i = 0; i < cobs.length; i++) {
    checkScoped(BORROWER_FIELDS, cobs[i] as ApplicationData, `coborrower${i + 1}`)
  }

  // Declaration + HMDA at root.
  checkScoped([...DECLARATION_FIELDS, ...HMDA_FIELDS], data, '')

  // Authorization signature (primary borrower). For broker variant, see future
  // ctx-aware overrides; today the borrower path always requires it.
  if (ctx.variant === 'borrower') {
    if (!data.auth_signature || data.auth_signature === '') {
      miss.push('auth_signature')
    }
  }

  return miss
}
