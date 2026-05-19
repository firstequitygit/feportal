import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendApplicationResumeEmail } from '@/lib/email'
import { rateLimit, clientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

// POST: create a new draft, email the resume link.
export async function POST(req: NextRequest) {
  if (!rateLimit(`draft-create:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  let body: { email?: string; firstName?: string; data?: Record<string, unknown> }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const email = (body.email ?? '').trim().toLowerCase()
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email is required to save your progress.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: row, error } = await admin
    .from('loan_applications')
    .insert({ status: 'draft', current_step: 1, resume_email: email, data: body.data ?? {} })
    .select('id, resume_token')
    .single()
  if (error || !row) return NextResponse.json({ error: 'Could not start application' }, { status: 500 })

  await sendApplicationResumeEmail(email, row.resume_token, body.firstName ?? null)
  return NextResponse.json({ success: true, id: row.id, resumeToken: row.resume_token })
}

// PATCH: autosave an existing draft (authorized by resume_token).
export async function PATCH(req: NextRequest) {
  if (!rateLimit(`draft-save:${clientIp(req)}`, 120, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  let body: { resumeToken?: string; data?: Record<string, unknown>; currentStep?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  if (!body.resumeToken) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from('loan_applications')
    .select('id, status')
    .eq('resume_token', body.resumeToken)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  if (existing.status === 'submitted') return NextResponse.json({ error: 'Already submitted' }, { status: 409 })

  const patch: Record<string, unknown> = {}
  if (body.data !== undefined) patch.data = body.data
  if (typeof body.currentStep === 'number') patch.current_step = Math.max(1, Math.min(6, body.currentStep))
  const { error } = await admin.from('loan_applications').update(patch).eq('id', existing.id)
  if (error) return NextResponse.json({ error: 'Save failed' }, { status: 500 })
  return NextResponse.json({ success: true })
}
