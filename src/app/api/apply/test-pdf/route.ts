import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { renderApplicationPdf } from '@/lib/pdf/application-pdf'
import { rateLimit, clientIp } from '@/lib/rate-limit'
import { isValidEmbedTestKey } from '@/lib/application/embed-test'
import type { ApplicationData } from '@/lib/application-fields'

export const runtime = 'nodejs'

async function requireAdmin(): Promise<boolean> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false
    const admin = createAdminClient()
    const { data } = await admin
      .from('admin_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle()
    return !!data
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  // Embed test mode: inside the WordPress iframe the admin cookie is third-party
  // and never arrives, so requireAdmin() can't authorize. A matching secret
  // header (forwarded by the test panel from the ?testkey embed URL param)
  // authorizes instead. See lib/application/embed-test.
  const authed = (await requireAdmin()) || isValidEmbedTestKey(req.headers.get('x-embed-test-key'))
  if (!authed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!rateLimit(`test-pdf:${clientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  let body: { data?: ApplicationData }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  if (!body.data || typeof body.data !== 'object') {
    return NextResponse.json({ error: 'Missing data' }, { status: 400 })
  }

  const pdf = await renderApplicationPdf(body.data)
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="test-application.pdf"',
      'Cache-Control': 'no-store',
    },
  })
}
