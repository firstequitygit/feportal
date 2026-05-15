import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { inviteBroker } from '@/lib/invite-broker'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()
  const { data: lo } = await adminClient
    .from('loan_officers').select('id').eq('auth_user_id', user.id).single()
  if (!lo) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { email, fullName, companyName } = await request.json()
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

  try {
    const result = await inviteBroker({ email, fullName, companyName })
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to invite broker' },
      { status: 500 }
    )
  }
}
