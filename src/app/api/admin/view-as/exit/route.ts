import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyViewAsCookie, VIEW_AS_COOKIE } from '@/lib/view-as-cookie'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const c = await cookies()
  const payload = verifyViewAsCookie(c.get(VIEW_AS_COOKIE)?.value)

  if (payload) {
    const admin = createAdminClient()
    const { data: openRow } = await admin
      .from('admin_impersonation_events')
      .select('id')
      .eq('admin_id', payload.admin_id)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (openRow) {
      await admin
        .from('admin_impersonation_events')
        .update({ ended_at: new Date().toISOString() })
        .eq('id', openRow.id)
    }
  }

  c.set(VIEW_AS_COOKIE, '', { path: '/', maxAge: 0 })
  return NextResponse.json({ redirectTo: '/admin' })
}
