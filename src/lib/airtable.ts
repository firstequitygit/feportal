// Airtable client for the one-way "Loan Details" sync from the portal
// (Postgres) → First Equity Reports base, Deals table.
//
// Public surface:
//   - syncLoanToAirtable(loanId)       sync ONE loan
//   - syncAllLoansToAirtable()         sync EVERY portal loan with a deal id
//
// Match key: Pipedrive Deal ID. Loans without a matching Airtable row are
// SKIPPED (we don't create Deal rows from the portal). Vendor rows in the
// linked Title/Insurance/Appraisers tables ARE find-or-created as needed.
//
// Auth: AIRTABLE_TOKEN env var (Personal Access Token, scopes data.records:read
// + data.records:write + schema.bases:read).

import { createAdminClient } from '@/lib/supabase/admin'
import {
  AIRTABLE_BASE_ID,
  AIRTABLE_DEALS_TABLE_ID,
  AIRTABLE_DEAL_ID_FIELD,
  buildAirtablePayload,
  portalLoanDetailsColumns,
  portalLoansColumns,
  type VendorPayload,
} from '@/lib/airtable-field-map'

// ============================================================
// Low-level Airtable fetch with retry/backoff for 429s
// ============================================================

const AIRTABLE_API = 'https://api.airtable.com/v0'

async function airtable<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = process.env.AIRTABLE_TOKEN
  if (!token) throw new Error('AIRTABLE_TOKEN not set')

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${AIRTABLE_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
    if (res.status === 429) {
      const wait = 1000 * Math.pow(2, attempt)
      await new Promise(r => setTimeout(r, wait))
      continue
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Airtable ${res.status} on ${path}: ${body.slice(0, 200)}`)
    }
    return res.json() as Promise<T>
  }
  throw new Error(`Airtable ${path}: exceeded retry limit (rate limited)`)
}

// ============================================================
// Find-or-create a vendor row, return its Airtable record id
// ============================================================

/**
 * In-process cache so a batch sync doesn't re-lookup the same vendor on
 * every loan. Keyed by `${tableId}::${companyLower}`.
 */
const vendorIdCache = new Map<string, string>()

async function findOrCreateVendor(v: VendorPayload): Promise<string> {
  const cacheKey = `${v.tableId}::${v.companyValue.toLowerCase()}`
  const cached = vendorIdCache.get(cacheKey)
  if (cached) {
    if (v.emailValue || v.phoneValue) await maybeUpdateVendor(v.tableId, cached, v)
    return cached
  }

  // Airtable filterByFormula needs the company value quoted + escaped.
  const escaped = v.companyValue.replace(/"/g, '\\"')
  const formula = `LOWER({${v.companyField}}) = "${escaped.toLowerCase()}"`
  const url = `/${AIRTABLE_BASE_ID}/${v.tableId}?` + new URLSearchParams({
    filterByFormula: formula,
    maxRecords: '1',
  }).toString()
  const found = await airtable<{ records: Array<{ id: string }> }>(url)

  let recordId: string
  if (found.records.length > 0) {
    recordId = found.records[0].id
    if (v.emailValue || v.phoneValue) await maybeUpdateVendor(v.tableId, recordId, v)
  } else {
    const fields: Record<string, unknown> = { [v.companyField]: v.companyValue }
    if (v.emailField && v.emailValue) fields[v.emailField] = v.emailValue
    if (v.phoneField && v.phoneValue) fields[v.phoneField] = v.phoneValue
    const created = await airtable<{ id: string }>(
      `/${AIRTABLE_BASE_ID}/${v.tableId}`,
      { method: 'POST', body: JSON.stringify({ fields }) },
    )
    recordId = created.id
  }

  vendorIdCache.set(cacheKey, recordId)
  return recordId
}

/** PATCH the vendor row's email/phone if the portal has values to push. */
async function maybeUpdateVendor(tableId: string, recordId: string, v: VendorPayload) {
  const fields: Record<string, unknown> = {}
  if (v.emailField && v.emailValue) fields[v.emailField] = v.emailValue
  if (v.phoneField && v.phoneValue) fields[v.phoneField] = v.phoneValue
  if (Object.keys(fields).length === 0) return
  await airtable(`/${AIRTABLE_BASE_ID}/${tableId}/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields }),
  })
}

// ============================================================
// Find a Deal row by Pipedrive Deal ID
// ============================================================

async function findDealRecordIdByPipedriveId(pipedriveDealId: string): Promise<string | null> {
  const escaped = pipedriveDealId.replace(/"/g, '\\"')
  const formula = `{${AIRTABLE_DEAL_ID_FIELD}} = "${escaped}"`
  const url = `/${AIRTABLE_BASE_ID}/${AIRTABLE_DEALS_TABLE_ID}?` + new URLSearchParams({
    filterByFormula: formula,
    maxRecords: '1',
  }).toString()
  const res = await airtable<{ records: Array<{ id: string }> }>(url)
  return res.records[0]?.id ?? null
}

// ============================================================
// Sync one loan
// ============================================================

export interface SyncResult {
  loanId: string
  status: 'updated' | 'skipped-no-deal-id' | 'skipped-no-airtable-row' | 'error'
  airtableRecordId?: string
  fieldsWritten?: number
  vendorsLinked?: number
  error?: string
}

export async function syncLoanToAirtable(loanId: string): Promise<SyncResult> {
  const supa = createAdminClient()

  // Pull only the columns the mapping cares about
  const { data: loan, error: loanErr } = await supa
    .from('loans')
    .select(portalLoansColumns().join(','))
    .eq('id', loanId)
    .single()
  if (loanErr || !loan) {
    return { loanId, status: 'error', error: loanErr?.message ?? 'loan not found' }
  }

  const loanRow = loan as unknown as Record<string, unknown>
  const dealId = loanRow.pipedrive_deal_id
  if (!dealId || typeof dealId !== 'string') {
    return { loanId, status: 'skipped-no-deal-id' }
  }

  const { data: detail } = await supa
    .from('loan_details')
    .select(portalLoanDetailsColumns().join(','))
    .eq('loan_id', loanId)
    .maybeSingle()
  const detailRow = (detail ?? null) as Record<string, unknown> | null

  // Resolve the Airtable Deal record id
  const recordId = await findDealRecordIdByPipedriveId(dealId)
  if (!recordId) return { loanId, status: 'skipped-no-airtable-row' }

  // Build the payload
  const { fields, vendors } = buildAirtablePayload(loanRow, detailRow)

  // Find-or-create each vendor row (in parallel — vendor cache de-dupes
  // identical companies across loans)
  const vendorResults = await Promise.all(vendors.map(async v => ({
    linkField: v.linkField,
    recordId: await findOrCreateVendor(v),
  })))
  for (const vr of vendorResults) {
    // Airtable multipleRecordLinks accept an array of record ids
    fields[vr.linkField] = [vr.recordId]
  }

  if (Object.keys(fields).length === 0) {
    return { loanId, status: 'updated', airtableRecordId: recordId, fieldsWritten: 0, vendorsLinked: 0 }
  }

  // PATCH the Deal row. typecast=true asks Airtable to coerce values where
  // possible (e.g. accept a number when the field is currency, accept a
  // singleSelect text that already matches one of the choices).
  await airtable(`/${AIRTABLE_BASE_ID}/${AIRTABLE_DEALS_TABLE_ID}/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields, typecast: true }),
  })

  return {
    loanId,
    status: 'updated',
    airtableRecordId: recordId,
    fieldsWritten: Object.keys(fields).length,
    vendorsLinked: vendorResults.length,
  }
}

// ============================================================
// Sync all loans
// ============================================================

export interface BatchSyncSummary {
  total: number
  updated: number
  skippedNoDealId: number
  skippedNoAirtableRow: number
  errors: number
  errorSample: Array<{ loanId: string; error: string }>
}

export async function syncAllLoansToAirtable(): Promise<BatchSyncSummary> {
  const supa = createAdminClient()

  // Stream loan ids (paginated, since the table can exceed 1000 rows)
  const loanIds: string[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supa
      .from('loans')
      .select('id')
      .not('pipedrive_deal_id', 'is', null)
      .range(from, from + 999)
    if (error) throw error
    if (!data?.length) break
    for (const l of data) loanIds.push(l.id)
    if (data.length < 1000) break
  }

  const summary: BatchSyncSummary = {
    total: loanIds.length,
    updated: 0,
    skippedNoDealId: 0,
    skippedNoAirtableRow: 0,
    errors: 0,
    errorSample: [],
  }

  // Sequential. Could be parallelized with care for Airtable rate limits
  // (5 req/sec/base). Keeping serial for v1; revisit if too slow.
  for (const id of loanIds) {
    try {
      const r = await syncLoanToAirtable(id)
      if (r.status === 'updated') summary.updated++
      else if (r.status === 'skipped-no-deal-id') summary.skippedNoDealId++
      else if (r.status === 'skipped-no-airtable-row') summary.skippedNoAirtableRow++
      else if (r.status === 'error') {
        summary.errors++
        if (summary.errorSample.length < 10) summary.errorSample.push({ loanId: id, error: r.error ?? '' })
      }
    } catch (e) {
      summary.errors++
      const msg = e instanceof Error ? e.message : String(e)
      if (summary.errorSample.length < 10) summary.errorSample.push({ loanId: id, error: msg })
    }
  }

  // Reset the vendor cache so the next batch run picks up any vendor-row
  // edits made directly in Airtable between syncs.
  vendorIdCache.clear()

  return summary
}
