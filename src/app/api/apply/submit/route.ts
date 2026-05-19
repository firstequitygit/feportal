import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { mapApplication } from '@/lib/application-mapper'
import {
  BORROWER_FIELDS, PRIMARY_EXTRA_FIELDS, DEAL_FIELDS, DECLARATION_FIELDS, HMDA_FIELDS,
  isRequired, type ApplicationData,
} from '@/lib/application-fields'
import { sendApplicationSubmittedEmail, sendApplicationLoanOfficerNotice } from '@/lib/email'
import { rateLimit, clientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

function missingRequired(data: ApplicationData): string[] {
  const miss: string[] = []
  const primary = (data.primary as Record<string, unknown>) ?? {}
  for (const f of [...BORROWER_FIELDS, ...PRIMARY_EXTRA_FIELDS, ...DECLARATION_FIELDS, ...HMDA_FIELDS]) {
    if (isRequired(f, data, primary) && (primary[f.name] === undefined || primary[f.name] === '' || primary[f.name] === null)) miss.push(`primary.${f.name}`)
  }
  for (const f of DEAL_FIELDS) {
    if (isRequired(f, data) && (data[f.name] === undefined || data[f.name] === '' || data[f.name] === null)) miss.push(f.name)
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

  // 6. Emails (best-effort).
  if (m.meta.primaryEmail) await sendApplicationSubmittedEmail(m.meta.primaryEmail, m.meta.primaryFirstName, m.meta.propertyAddress)
  const { data: anyLo } = await admin.from('loan_officers').select('email').not('email', 'is', null).limit(1).maybeSingle()
  if (anyLo?.email) await sendApplicationLoanOfficerNotice(anyLo.email, m.borrowers[0]?.full_name ?? 'Applicant', m.meta.propertyAddress, loanId)

  return NextResponse.json({ success: true, loanId })
}
