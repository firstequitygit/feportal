import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { signViewAsCookie, VIEW_AS_COOKIE, type ViewAsKind } from '@/lib/view-as-cookie'

const REDIRECT_BY_KIND: Record<ViewAsKind, string> = {
  borrower:       '/dashboard',
  broker:         '/broker',
  loan_officer:   '/loan-officer/inbox',
  loan_processor: '/loan-processor/inbox',
  underwriter:    '/underwriter/inbox',
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminRow } = await admin
    .from('admin_users').select('id').eq('auth_user_id', user.id).maybeSingle()
  if (!adminRow) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null) as { kind?: ViewAsKind; id?: string } | null
  const kind = body?.kind
  const id   = body?.id
  if (!kind || !id || !(kind in REDIRECT_BY_KIND)) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }

  const startedAt = new Date().toISOString()

  await admin.from('admin_impersonation_events').insert({
    admin_id: adminRow.id,
    target_kind: kind,
    target_id: id,
    started_at: startedAt,
    user_agent: req.headers.get('user-agent'),
  })

  const cookie = signViewAsCookie({
    kind, target_id: id, admin_id: adminRow.id, started_at: startedAt,
  })

  const c = await cookies()
  c.set(VIEW_AS_COOKIE, cookie, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  })

  return NextResponse.json({ redirectTo: REDIRECT_BY_KIND[kind] })
}
