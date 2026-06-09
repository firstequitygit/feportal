import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { submitApplication } from '@/lib/application/submit-core'
import { BROKER_ATTESTATION_BODY } from '@/lib/application/variants'
import type { ApplicationData } from '@/lib/application-fields'
import { rateLimit, clientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  if (!rateLimit(`submit:broker:${clientIp(req)}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: broker } = await admin
    .from('brokers')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (!broker) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { resumeToken?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  if (!body.resumeToken) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const { data: app } = await admin
    .from('loan_applications')
    .select('id, status, data, submitted_loan_id, submitted_by_broker_id, application_kind')
    .eq('resume_token', body.resumeToken)
    .maybeSingle()
  if (!app) return NextResponse.json({ error: 'Application not found' }, { status: 404 })
  if (app.application_kind !== 'broker' || app.submitted_by_broker_id !== broker.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const data = (app.data ?? {}) as ApplicationData
  const result = await submitApplication(
    { id: app.id, status: app.status, data, submitted_loan_id: app.submitted_loan_id },
    { variant: 'broker', submittedByBrokerId: broker.id },
  )

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.missing ? { missing: result.missing } : {}) },
      { status: result.status },
    )
  }

  // Freeze the attestation text + typed signature onto the loan row so legal
  // copy changes later can't retroactively change what the broker agreed to.
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
