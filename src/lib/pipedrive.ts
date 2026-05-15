import {
  PIPEDRIVE_FIELDS,
  PIPEDRIVE_LOAN_TYPE_MAP,
  PIPEDRIVE_STAGE_MAP,
  type LoanType,
  type PipelineStage,
} from './types'

const BASE_URL = 'https://api.pipedrive.com/v1'
const TOKEN = process.env.PIPEDRIVE_API_TOKEN

async function pipedriveGet(path: string) {
  const separator = path.includes('?') ? '&' : '?'
  const res = await fetch(`${BASE_URL}${path}${separator}api_token=${TOKEN}&limit=500`, {
    next: { revalidate: 0 },
  })
  if (!res.ok) throw new Error(`Pipedrive API error: ${res.status}`)
  return res.json()
}

// Paginated fetch — Pipedrive caps each page at 500 and signals more via
// additional_data.pagination.more_items_in_collection. Loop until done.
async function pipedriveGetAllPages(path: string): Promise<unknown[]> {
  const all: unknown[] = []
  let start = 0
  while (true) {
    const separator = path.includes('?') ? '&' : '?'
    const url = `${BASE_URL}${path}${separator}api_token=${TOKEN}&limit=500&start=${start}`
    const res = await fetch(url, { next: { revalidate: 0 } })
    if (!res.ok) throw new Error(`Pipedrive API error: ${res.status}`)
    const json = await res.json()
    const page = json.data as unknown[] | null
    if (!page || page.length === 0) break
    all.push(...page)
    const more = json.additional_data?.pagination?.more_items_in_collection
    const next = json.additional_data?.pagination?.next_start
    if (!more || typeof next !== 'number') break
    start = next
  }
  return all
}

export interface PipedriveDeal {
  id: number
  title: string
  stage_id: number
  value?: number | null  // Pipedrive's default deal value field — FE uses this for loan amount
  status?: 'open' | 'won' | 'lost' | 'deleted' | string
  pipeline_id?: number
  person_id?: { name: string; value: number } | null
  custom_fields?: Record<string, unknown>  // Automated Webhooks nest custom fields here
  [key: string]: unknown
}

export interface NormalizedDeal {
  pipedrive_deal_id: number
  pipedrive_status: string         // 'open' | 'won' | 'lost' — drives archived rules
  pipedrive_pipeline_id: number | null
  property_address: string | null
  pipeline_stage: PipelineStage | null
  pipedrive_person_id: number | null
  borrower_name: string | null
  loan_amount: number | null
  loan_type: LoanType | null
  interest_rate: number | null
  ltv: number | null
  arv: number | null
  rehab_budget: number | null
  term_months: number | null
  origination_date: string | null
  maturity_date: string | null
  entity_name: string | null
  loan_number: string | null
  rate_locked_days: string | null
  rate_lock_expiration_date: string | null
  interest_only: string | null
  loan_type_ii: string | null
  closed_at: string | null               // Pipedrive won_time, normalized to ISO (only when status=won)
  estimated_closing_date: string | null  // Pipedrive "Closing Date" custom field — scheduled/expected close
}

function getField(deal: PipedriveDeal, key: string): unknown {
  // Regular API puts custom fields as top-level keys
  // Automated Webhooks nest them under custom_fields
  if (deal[key] !== undefined && deal[key] !== null) return deal[key]
  return deal.custom_fields?.[key]
}

function toNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null
  // Pipedrive may wrap values in objects depending on field type / source:
  //   { value: 500000, currency: 'USD' } — monetary
  //   { value: 36 } — webhook-wrapped enums
  //   { id: 36, label: 'Fix & Flip' } — option fields via some endpoints
  if (typeof val === 'object' && val !== null) {
    const obj = val as Record<string, unknown>
    if ('value' in obj) val = obj.value
    else if ('id' in obj) val = obj.id
    else return null
  }
  const n = Number(val)
  return isNaN(n) ? null : n
}

function toString(val: unknown): string | null {
  if (val === null || val === undefined || val === '') return null
  // Pipedrive returns objects for some text/reference fields:
  //   { value: 'Some Text' } — text via webhook
  //   { name: 'Org Name', value: 123 } — organization reference
  //   { name: 'Person', value: 12, email: ... } — person reference
  if (typeof val === 'object' && val !== null) {
    const obj = val as Record<string, unknown>
    if (typeof obj.value === 'string' && obj.value) return obj.value
    if (typeof obj.name === 'string' && obj.name) return obj.name
    return null
  }
  const s = String(val)
  return s === '' ? null : s
}

export function normalizeDeal(deal: PipedriveDeal): NormalizedDeal {
  const f = PIPEDRIVE_FIELDS

  // Loan Type: Pipedrive returns option ID as a number
  const loanTypeRaw = toNumber(getField(deal, f.loanType))
  const loanType: LoanType | null =
    loanTypeRaw !== null ? (PIPEDRIVE_LOAN_TYPE_MAP[loanTypeRaw] ?? null) : null

  // Property address: prefer FE's structured Property Address field;
  // fall back to deal title if not populated.
  const structuredAddress = toString(getField(deal, f.propertyAddress))
  const propertyAddress = structuredAddress ?? toString(deal.title)

  return {
    pipedrive_deal_id:  deal.id,
    pipedrive_status:   (deal.status as string) ?? 'open',
    pipedrive_pipeline_id: typeof deal.pipeline_id === 'number' ? deal.pipeline_id : null,
    property_address:   propertyAddress,
    pipeline_stage:     PIPEDRIVE_STAGE_MAP[deal.stage_id] ?? null,
    pipedrive_person_id: deal.person_id?.value ?? null,
    borrower_name:      deal.person_id?.name ?? null,
    loan_amount:        toNumber(deal.value), // FE: default deal value field, not a custom field
    loan_type:          loanType,
    interest_rate:      toNumber(getField(deal, f.interestRate)),
    ltv:                toNumber(getField(deal, f.ltv)),
    arv:                toNumber(getField(deal, f.arv)),
    rehab_budget:       toNumber(getField(deal, f.rehabBudget)),
    term_months:        toNumber(getField(deal, f.termMonths)),
    origination_date:   toString(getField(deal, f.originationDate)),
    maturity_date:      toString(getField(deal, f.maturityDate)),
    entity_name:        toString(getField(deal, f.entityName)),
    loan_number:               toString(getField(deal, f.loanNumber)),
    rate_locked_days:          toString(getField(deal, f.rateLocked)),
    rate_lock_expiration_date: toString(getField(deal, f.rateLockExpiration)),
    interest_only:             toString(getField(deal, f.interestOnly)),
    loan_type_ii:              toString(getField(deal, f.loanTypeII)),
    // Pipedrive won_time is "YYYY-MM-DD HH:MM:SS" UTC; normalize to ISO.
    // Only populate closed_at when the deal's current status is 'won'.
    // Pipedrive keeps won_time on deals later reopened/marked lost, so
    // checking status is required — otherwise lost deals leak into the
    // Closings report.
    closed_at:
      deal.status === 'won' && typeof deal.won_time === 'string' && deal.won_time
        ? new Date(deal.won_time.replace(' ', 'T') + 'Z').toISOString()
        : null,
    // Pipedrive custom field "Closing Date" — the scheduled/expected close
    // used by FE's monthly closings report. Comes through as "YYYY-MM-DD".
    estimated_closing_date: toString(getField(deal, f.closingDate)),
  }
}

// Fetches every Pipeline-2 deal (FE's "Deals Pipeline") across open, won,
// and lost statuses, paginated. Pipedrive's /deals endpoint ignores
// pipeline_id as a query param so we filter client-side. The Leads
// Pipeline (id 6) is excluded entirely — those are pre-application
// leads, not loans worth tracking in the portal.
//
// Sync route decides archived state from `pipedrive_status`:
//   open → archived=false (active, claimable)
//   won  → archived left untouched (auto-archive cron handles after 30d)
//   lost → archived=true (in portal as historical record, not claimable)
export async function fetchAllDeals(): Promise<NormalizedDeal[]> {
  const [open, won, lost] = await Promise.all([
    pipedriveGetAllPages('/deals?status=open'),
    pipedriveGetAllPages('/deals?status=won'),
    pipedriveGetAllPages('/deals?status=lost'),
  ])
  const all = [...open, ...won, ...lost] as PipedriveDeal[]
  const pipeline2 = all.filter(d => d.pipeline_id === 2)
  return pipeline2.map(normalizeDeal)
}

export async function fetchDeal(dealId: number): Promise<NormalizedDeal | null> {
  const data = await pipedriveGet(`/deals/${dealId}`)
  if (!data.success || !data.data) return null
  return normalizeDeal(data.data as PipedriveDeal)
}

/**
 * Update a deal's stage in Pipedrive. Throws on non-2xx.
 */
export async function updateDealStage(dealId: number, stageId: number): Promise<void> {
  const res = await fetch(`${BASE_URL}/deals/${dealId}?api_token=${TOKEN}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage_id: stageId }),
    cache: 'no-store',
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Pipedrive stage update failed (${res.status}): ${body}`)
  }
  const data = await res.json().catch(() => null)
  if (data && data.success === false) {
    throw new Error(`Pipedrive stage update rejected: ${data.error ?? 'unknown'}`)
  }
}

/**
 * Update an arbitrary deal field (custom or built-in) in Pipedrive.
 * fieldKey is the Pipedrive field hash (for custom fields) or built-in
 * key like 'title'. value should be the canonical value Pipedrive expects
 * for that field type — number for monetary/numeric/option, ISO string
 * for date, plain string for text. Pass null to clear.
 */
export async function updateDealField(
  dealId: number,
  fieldKey: string,
  value: string | number | null,
): Promise<void> {
  const res = await fetch(`${BASE_URL}/deals/${dealId}?api_token=${TOKEN}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [fieldKey]: value }),
    cache: 'no-store',
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Pipedrive field update failed (${res.status}): ${body}`)
  }
  const data = await res.json().catch(() => null)
  if (data && data.success === false) {
    throw new Error(`Pipedrive field update rejected: ${data.error ?? 'unknown'}`)
  }
}

// ===== Person + Deal creation (used by JotForm intake) =====

export interface PipedrivePersonPayload {
  name: string
  email?: string
  phone?: string
  /** Map of custom field hash key → value (string for text/date, number for option ID). */
  customFields?: Record<string, string | number | null>
}

export interface PipedriveDealPayload {
  title: string
  personId?: number
  /** Loan amount; sent as Pipedrive's `value` field. */
  value?: number | null
  currency?: string
  stageId?: number
  /** Map of custom field hash key → value (string for text/date, number for option ID/monetary/numeric). */
  customFields?: Record<string, string | number | null>
}

/**
 * Create a Pipedrive person. Returns the new person ID.
 * Pipedrive accepts a single email/phone string or an array of objects;
 * for our purposes a single primary value is enough.
 */
export async function createPerson(payload: PipedrivePersonPayload): Promise<number> {
  const body: Record<string, unknown> = { name: payload.name }
  if (payload.email) body.email = [{ value: payload.email, primary: true, label: 'work' }]
  if (payload.phone) body.phone = [{ value: payload.phone, primary: true, label: 'work' }]
  for (const [key, val] of Object.entries(payload.customFields ?? {})) {
    if (val !== null && val !== undefined && val !== '') body[key] = val
  }

  const res = await fetch(`${BASE_URL}/persons?api_token=${TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Pipedrive person create failed (${res.status}): ${text}`)
  }
  const data = await res.json()
  if (!data.success || !data.data?.id) {
    throw new Error(`Pipedrive person create rejected: ${data.error ?? 'unknown'}`)
  }
  return data.data.id as number
}

/**
 * Create a Pipedrive deal. Returns the new deal ID.
 */
export async function createDeal(payload: PipedriveDealPayload): Promise<number> {
  const body: Record<string, unknown> = { title: payload.title }
  if (payload.personId) body.person_id = payload.personId
  if (payload.value !== null && payload.value !== undefined) body.value = payload.value
  if (payload.currency) body.currency = payload.currency
  if (payload.stageId) body.stage_id = payload.stageId
  for (const [key, val] of Object.entries(payload.customFields ?? {})) {
    if (val !== null && val !== undefined && val !== '') body[key] = val
  }

  const res = await fetch(`${BASE_URL}/deals?api_token=${TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Pipedrive deal create failed (${res.status}): ${text}`)
  }
  const data = await res.json()
  if (!data.success || !data.data?.id) {
    throw new Error(`Pipedrive deal create rejected: ${data.error ?? 'unknown'}`)
  }
  return data.data.id as number
}

/**
 * Resolve the option ID for a single-option Pipedrive Person custom field
 * by matching its visible label (case-insensitive). Single-option fields
 * require an option ID rather than the label string when writing.
 *
 * Caches the personFields response in module memory for the lifetime of
 * the request handler — a single webhook invocation. No long-lived cache.
 */
let personFieldsCache: Record<string, unknown>[] | null = null
async function getPersonFieldsRaw(): Promise<Record<string, unknown>[]> {
  if (personFieldsCache) return personFieldsCache
  const data = await pipedriveGet('/personFields')
  if (!data.success || !Array.isArray(data.data)) return []
  const fields = data.data as Record<string, unknown>[]
  personFieldsCache = fields
  return fields
}

export async function resolvePersonOptionId(
  fieldKey: string,
  label: string,
): Promise<number | null> {
  if (!label) return null
  const fields = await getPersonFieldsRaw()
  const field = fields.find(f => (f as { key?: string }).key === fieldKey)
  if (!field) return null
  const options = (field as { options?: { id: number; label: string }[] }).options
  if (!options) return null
  const match = options.find(o => o.label.trim().toLowerCase() === label.trim().toLowerCase())
  return match ? match.id : null
}
