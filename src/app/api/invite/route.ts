import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { inviteBorrower } from '@/lib/invite-borrower'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()
  const { data: admin } = await adminClient
    .from('admin_users').select('id').eq('auth_user_id', user.id).single()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { email, fullName } = await request.json()
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

  try {
    const result = await inviteBorrower({ email, fullName })
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to invite borrower' },
      { status: 500 }
    )
  }
}
