import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { submitApplication } from '@/lib/application/submit-core'
import type { ApplicationData } from '@/lib/application-fields'
import { rateLimit, clientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

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

  const result = await submitApplication(
    { id: app.id, status: app.status, data: (app.data ?? {}) as ApplicationData, submitted_loan_id: app.submitted_loan_id },
    { variant: 'borrower' },
  )

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.missing ? { missing: result.missing } : {}) },
      { status: result.status },
    )
  }
  return NextResponse.json({
    success: true,
    loanId: result.loanId,
    ...(result.alreadySubmitted ? { alreadySubmitted: true } : {}),
  })
}
