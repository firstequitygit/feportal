import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminRow } = await admin
    .from('admin_users').select('id').eq('auth_user_id', user.id).maybeSingle()
  if (!adminRow) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  const kind = url.searchParams.get('kind') ?? 'borrower'
  if (kind !== 'borrower' || q.length < 1) {
    return NextResponse.json({ results: [] })
  }

  const pattern = `%${q.replace(/[%_]/g, '\\$&')}%`
  const { data } = await admin
    .from('borrowers')
    .select('id, full_name, email')
    .or(`full_name.ilike.${pattern},email.ilike.${pattern}`)
    .order('full_name')
    .limit(20)

  return NextResponse.json({ results: data ?? [] })
}
