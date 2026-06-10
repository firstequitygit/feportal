import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { submitApplication } from '@/lib/application/submit-core'
import { BROKER_ATTESTATION_BODY } from '@/lib/application/variants'
import type { ApplicationData } from '@/lib/application-fields'
import { rateLimit, clientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

// Public broker submit. Authorized solely by the resume_token (the token is
// the auth). application_kind='broker' must already be stamped on the row by
// the draft route — that's our defense against a borrower resume_token being
// pointed at this endpoint.
export async function POST(req: NextRequest) {
  if (!rateLimit(`submit:broker:${clientIp(req)}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  let body: { resumeToken?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  if (!body.resumeToken) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const admin = createAdminClient()
  const { data: app } = await admin
    .from('loan_applications')
    .select('id, status, data, submitted_loan_id, application_kind')
    .eq('resume_token', body.resumeToken)
    .maybeSingle()
  if (!app) return NextResponse.json({ error: 'Application not found' }, { status: 404 })
  if (app.application_kind !== 'broker') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const data = (app.data ?? {}) as ApplicationData
  const result = await submitApplication(
    { id: app.id, status: app.status, data, submitted_loan_id: app.submitted_loan_id },
    { variant: 'broker', submittedByBrokerId: null },
  )

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.missing ? { missing: result.missing } : {}) },
      { status: result.status },
    )
  }

  if (result.loanId && !result.alreadySubmitted) {
    const signedName = typeof data.broker_attestation_signature === 'string'
      ? data.broker_attestation_signature
      : null
    await admin
      .from('loans')
      .update({
        broker_attestation_text: BROKER_ATTESTATION_BODY,
        broker_attestation_signed_name: signedName,
        broker_attestation_signed_at: new Date().toISOString(),
      })
      .eq('id', result.loanId)
  }

  return NextResponse.json({
    success: true,
    loanId: result.loanId,
    ...(result.authorizeToken ? { authorizeToken: result.authorizeToken } : {}),
    ...(result.alreadySubmitted ? { alreadySubmitted: true } : {}),
  })
}
