import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: admin } = await supabase
    .from('admin_users').select('id').eq('auth_user_id', user.id).single()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { loanId, loanProcessorId, loanProcessorId2 } = await request.json()
  if (!loanId) return NextResponse.json({ error: 'Missing loanId' }, { status: 400 })

  // Both slots must be distinct when both are set
  if (loanProcessorId && loanProcessorId2 && loanProcessorId === loanProcessorId2) {
    return NextResponse.json({ error: 'The two slots must be different processors' }, { status: 400 })
  }

  const { error } = await createAdminClient()
    .from('loans')
    .update({
      loan_processor_id:   loanProcessorId   || null,
      loan_processor_id_2: loanProcessorId2 || null,
    })
    .eq('id', loanId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
