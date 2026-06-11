import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ApplicationData } from '@/lib/application-fields'
import { missingRequired } from '@/lib/application/validate'
import { renderApplicationPdf } from '@/lib/pdf/application-pdf'
import { sendApplicationTestNotifications, type TestOverrides } from '@/lib/apply-notify-test'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

// Admin-only. Mirrors /api/apply/test-submit but routes through the broker
// variant validator (broker identity required on primary; broker_attestation_signature
// at root in lieu of auth_signature + payment_signature).
async function requireAdmin(): Promise<string | null> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const admin = createAdminClient()
    const { data } = await admin
      .from('admin_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle()
    return data ? user.id : null
  } catch {
    return null
  }
}

function validEmail(s: unknown): s is string {
  return typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)
}

// Embed test mode: inside the WordPress iframe the admin cookie is third-party
// and never arrives, so requireAdmin() can't authorize. A matching secret
// header (set by the wizard from the ?testkey embed URL param) authorizes the
// test submit instead. Gated on a non-empty BROKER_EMBED_TEST_KEY env var.
function hasValidEmbedKey(req: NextRequest): boolean {
  const envKey = process.env.BROKER_EMBED_TEST_KEY ?? ''
  if (!envKey) return false
  return req.headers.get('x-embed-test-key') === envKey
}

export async function POST(req: NextRequest) {
  const adminUserId = await requireAdmin()
  const actorId = adminUserId ?? (hasValidEmbedKey(req) ? 'embed-test' : null)
  if (!actorId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (!rateLimit(`test-submit-broker:${actorId}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: {
    data?: ApplicationData
    overrides?: Partial<TestOverrides>
    scenarioLabel?: string | null
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  if (!body.data || typeof body.data !== 'object') {
    return NextResponse.json({ error: 'Missing data' }, { status: 400 })
  }
  const o = body.overrides ?? {}
  if (!validEmail(o.borrowerEmail) || !validEmail(o.processingInbox) || !validEmail(o.loEmail)) {
    return NextResponse.json({ error: 'All three override email addresses are required and must be well-formed.' }, { status: 400 })
  }
  const overrides: TestOverrides = {
    borrowerEmail: o.borrowerEmail,
    processingInbox: o.processingInbox,
    loEmail: o.loEmail,
  }

  const miss = missingRequired(body.data, { variant: 'broker' })
  if (miss.length) {
    return NextResponse.json({ error: 'Some required fields are missing', missing: miss }, { status: 422 })
  }

  const pdf = await renderApplicationPdf(body.data)
  const result = await sendApplicationTestNotifications({
    data: body.data,
    pdf,
    overrides,
    scenarioLabel: typeof body.scenarioLabel === 'string' ? body.scenarioLabel : null,
  })

  return NextResponse.json({
    success: true,
    recipients: { borrower: result.borrower, internal: result.internal },
    pdfBytes: result.pdfBytes,
    scenario: body.scenarioLabel ?? null,
  })
}
