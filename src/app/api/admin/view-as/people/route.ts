import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminRow } = await admin
    .from('admin_users').select('id').eq('auth_user_id', user.id).maybeSingle()
  if (!adminRow) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const [los, lps, uws, brokers] = await Promise.all([
    admin.from('loan_officers').select('id, full_name, email').order('full_name'),
    admin.from('loan_processors').select('id, full_name, email').order('full_name'),
    admin.from('underwriters').select('id, full_name, email').order('full_name'),
    admin.from('brokers').select('id, full_name, email, company_name').order('full_name'),
  ])

  return NextResponse.json({
    loan_officers:   los.data ?? [],
    loan_processors: lps.data ?? [],
    underwriters:    uws.data ?? [],
    brokers:         brokers.data ?? [],
  })
}
