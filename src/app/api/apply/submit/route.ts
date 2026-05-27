import { NextRequest, NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { mapApplication } from '@/lib/application-mapper'
import {
  BORROWER_FIELDS, PRIMARY_EXTRA_FIELDS, DEAL_FIELDS, UNIT_FIELDS, DECLARATION_FIELDS, HMDA_FIELDS,
  dscrUnitCount, isRequired, type ApplicationData,
} from '@/lib/application-fields'
import { sendApplicationNotifications } from '@/lib/apply-notify'
import { rateLimit, clientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return true
  if (Array.isArray(v) && v.length === 0) return true
  return false
}

function missingRequired(data: ApplicationData): string[] {
  const miss: string[] = []
  const primary = (data.primary as Record<string, unknown>) ?? {}

  // Primary: BORROWER_FIELDS + PRIMARY_EXTRA_FIELDS
  for (const f of [...BORROWER_FIELDS, ...PRIMARY_EXTRA_FIELDS]) {
    if (isRequired(f, data, primary) && isEmpty(primary[f.name])) {
      miss.push(`primary.${f.name}`)
    }
  }

  // Deal fields: scope is the form root (no prefix)
  for (const f of DEAL_FIELDS) {
    if (isRequired(f, data) && isEmpty(data[f.name])) {
      miss.push(f.name)
    }
  }

  // Per-unit rental fields (DSCR loans only)
  const unitCount = dscrUnitCount(data)
  if (unitCount > 0) {
    const units = Array.isArray(data.units) ? (data.units as Record<string, unknown>[]) : []
    for (let i = 0; i < unitCount; i++) {
      const scope = (units[i] ?? {}) as ApplicationData
      for (const f of UNIT_FIELDS) {
        if (isRequired(f, data, scope) && isEmpty(scope[f.name as keyof typeof scope])) {
          miss.push(`unit${i + 1}.${f.name}`)
        }
      }
    }
  }

  // Co-borrowers: BORROWER_FIELDS only (no PRIMARY_EXTRA_FIELDS, DECLARATION_FIELDS, or HMDA_FIELDS).
  // Declarations, HMDA, and Experience are application-level, not per-borrower — validated below.
  const cobs: Record<string, unknown>[] = Array.isArray(data.co_borrowers)
    ? (data.co_borrowers as Record<string, unknown>[])
    : []
  for (let i = 0; i < cobs.length; i++) {
    const scope = cobs[i]
    const prefix = `coborrower${i + 1}`
    for (const f of BORROWER_FIELDS) {
      if (isRequired(f, data, scope) && isEmpty(scope[f.name])) {
        miss.push(`${prefix}.${f.name}`)
      }
    }
  }

  // Declaration + HMDA fields at root scope — one set for the whole application
  for (const f of [...DECLARATION_FIELDS, ...HMDA_FIELDS]) {
    if (isRequired(f, data) && isEmpty(data[f.name])) {
      miss.push(f.name)
    }
  }

  // Authorization signature (primary borrower)
  if (!data.auth_signature || data.auth_signature === "") {
    miss.push("auth_signature")
  }

  return miss
}

export async function POST(req: NextRequest) {
  if (!rateLimit(`submit:${clientIp(req)}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  let body: { resumeToken?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  if (!body.resumeToken) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const admin = createAdminClient()
  const { data: app } = await admin
    .from('loan_applications')
    .select('id, status, data, submitted_loan_id')
    .eq('resume_token', body.resumeToken)
    .maybeSingle()
  if (!app) return NextResponse.json({ error: 'Application not found' }, { status: 404 })
  if (app.status === 'submitted') {
    return NextResponse.json({ success: true, alreadySubmitted: true, loanId: app.submitted_loan_id })
  }

  const data = (app.data ?? {}) as ApplicationData
  const miss = missingRequired(data)
  if (miss.length) return NextResponse.json({ error: 'Some required fields are missing', missing: miss }, { status: 422 })

  const m = mapApplication(data)

  // 1. Insert borrowers (email is UNIQUE NOT NULL on borrowers — upsert on email).
  const borrowerIds: (string | null)[] = []
  for (const bw of m.borrowers) {
    if (!bw.email) { borrowerIds.push(null); continue }
    const fullPayload: Record<string, unknown> = {
      email: bw.email.toLowerCase(), full_name: bw.full_name, phone: bw.phone, entity_name: bw.entity_name,
      current_address_street: bw.current_address_street, current_address_city: bw.current_address_city,
      current_address_state: bw.current_address_state, current_address_zip: bw.current_address_zip,
      at_current_address_2y: bw.at_current_address_2y,
      prior_address_street: bw.prior_address_street, prior_address_city: bw.prior_address_city,
      prior_address_state: bw.prior_address_state, prior_address_zip: bw.prior_address_zip,
    }
    const payload = Object.fromEntries(
      Object.entries(fullPayload).filter(([k, v]) =>
        k === 'email' || k === 'full_name' || (v !== null && v !== undefined)),
    )
    const { data: brow, error: berr } = await admin
      .from('borrowers')
      .upsert(payload, { onConflict: 'email' })
      .select('id').single()
    if (berr || !brow) return NextResponse.json({ error: 'Failed to save borrower' }, { status: 500 })
    borrowerIds.push(brow.id)
  }

  // 2. Insert loan.
  const { data: loanRow, error: lerr } = await admin
    .from('loans')
    .insert({
      pipedrive_deal_id: null,
      borrower_id: borrowerIds[0] ?? null,
      borrower_id_2: borrowerIds[1] ?? null,
      borrower_id_3: borrowerIds[2] ?? null,
      borrower_id_4: borrowerIds[3] ?? null,
      property_address: m.loan.property_address,
      loan_type: m.loan.loan_type,
      loan_amount: m.loan.loan_amount,
      entity_name: m.loan.entity_name,
      pipeline_stage: 'New Application',
    })
    .select('id').single()
  if (lerr || !loanRow) return NextResponse.json({ error: 'Failed to create loan' }, { status: 500 })
  const loanId = loanRow.id

  // 3. loan_details + loan_demographics. On hard failure, roll back the loan
  //    (FK ON DELETE CASCADE cleans children) and leave the draft as 'draft'.
  const { error: ldErr } = await admin.from('loan_details').upsert(
    { loan_id: loanId, ...m.loanDetails, updated_at: new Date().toISOString() },
    { onConflict: 'loan_id' })
  if (ldErr) {
    await admin.from('loans').delete().eq('id', loanId)
    return NextResponse.json({ error: 'Could not finalize application' }, { status: 500 })
  }
  if (m.loanDemographics.ethnicity || m.loanDemographics.race || m.loanDemographics.sex) {
    const { error: dErr } = await admin.from('loan_demographics').upsert(
      { loan_id: loanId, ...m.loanDemographics, source: 'loan_application' },
      { onConflict: 'loan_id' })
    if (dErr) {
      await admin.from('loans').delete().eq('id', loanId)
      return NextResponse.json({ error: 'Could not finalize application' }, { status: 500 })
    }
  }

  // 4. Mark draft submitted + link loan. If this fails, roll back the loan so a
  //    retry does not create a duplicate (draft stays 'draft').
  const { error: appErr } = await admin.from('loan_applications')
    .update({ status: 'submitted', submitted_loan_id: loanId })
    .eq('id', app.id)
  if (appErr) {
    await admin.from('loans').delete().eq('id', loanId)
    return NextResponse.json({ error: 'Could not finalize application' }, { status: 500 })
  }

  // 5. Audit (best-effort — non-fatal if it fails).
  await admin.from('loan_events').insert({
    loan_id: loanId, event_type: 'application_received',
    description: `Loan application submitted via portal (application ${app.id})`,
  })

  // 6. Notifications (best-effort, off the response critical path).
  after(async () => {
    try {
      await sendApplicationNotifications({ loanId, data, m })
    } catch (err) {
      console.error('Application notifications failed:', err)
    }
  })

  return NextResponse.json({ success: true, loanId })
}
