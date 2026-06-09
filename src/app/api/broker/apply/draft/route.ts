import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit, clientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

// Auth helper - resolves the authenticated broker row or returns null.
async function getCallingBroker() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: broker } = await admin
    .from('brokers')
    .select('id, email')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (!broker) return null
  return { admin, broker }
}

// POST: ensure a draft exists for the calling broker. The page already
// server-side seeds a draft on load, so this is mainly a safety fallback for
// the Wizard's email-blur ensureDraft() path.
export async function POST(req: NextRequest) {
  if (!rateLimit(`broker-draft-create:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const ctx = await getCallingBroker()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { admin, broker } = ctx

  try { await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const { data: existing } = await admin
    .from('loan_applications')
    .select('id, resume_token')
    .eq('submitted_by_broker_id', broker.id)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ success: true, id: existing.id, resumeToken: existing.resume_token })
  }

  // Authoritative seeding happens in /broker/apply/page.tsx server-side; this
  // POST is the wizard's email-blur fallback. We intentionally do NOT trust
  // any client-supplied data blob here — the broker can poison their own JSONB
  // payload otherwise, and the page already wrote the broker-identity fields.
  const { data: row, error } = await admin
    .from('loan_applications')
    .insert({
      status: 'draft',
      current_step: 1,
      application_kind: 'broker',
      submitted_by_broker_id: broker.id,
      resume_email: broker.email,
      data: {},
    })
    .select('id, resume_token')
    .single()
  if (error || !row) return NextResponse.json({ error: 'Could not start application' }, { status: 500 })

  return NextResponse.json({ success: true, id: row.id, resumeToken: row.resume_token })
}

// PATCH: autosave. Verifies the broker owns the draft before touching it.
export async function PATCH(req: NextRequest) {
  if (!rateLimit(`broker-draft-save:${clientIp(req)}`, 120, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const ctx = await getCallingBroker()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { admin, broker } = ctx

  let body: { resumeToken?: string; data?: Record<string, unknown>; currentStep?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  if (!body.resumeToken) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const { data: existing } = await admin
    .from('loan_applications')
    .select('id, status, submitted_by_broker_id')
    .eq('resume_token', body.resumeToken)
    .maybeSingle()
  if (!existing || existing.submitted_by_broker_id !== broker.id) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  }
  if (existing.status === 'submitted') return NextResponse.json({ error: 'Already submitted' }, { status: 409 })

  const patch: Record<string, unknown> = {}
  if (body.data !== undefined) patch.data = body.data
  if (typeof body.currentStep === 'number') patch.current_step = Math.max(1, Math.min(6, body.currentStep))
  const { error } = await admin.from('loan_applications').update(patch).eq('id', existing.id)
  if (error) return NextResponse.json({ error: 'Save failed' }, { status: 500 })
  return NextResponse.json({ success: true })
}
