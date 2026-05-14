import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const VALID_CATEGORIES = ['initial', 'underwriting', 'pre_close', 'pre_funding']

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()

  const [{ data: admin }, { data: lo }, { data: lp }, { data: uw }] = await Promise.all([
    adminClient.from('admin_users').select('id').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_officers').select('id').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_processors').select('id').eq('auth_user_id', user.id).single(),
    adminClient.from('underwriters').select('id').eq('auth_user_id', user.id).single(),
  ])

  if (!admin && !lo && !lp && !uw) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { conditionId, category } = await req.json()
  if (!conditionId) return NextResponse.json({ error: 'Missing conditionId' }, { status: 400 })

  const safeCategory = category && VALID_CATEGORIES.includes(category) ? category : null

  const { data: condition } = await adminClient
    .from('conditions')
    .select('id, loan_id, title, category')
    .eq('id', conditionId)
    .single()
  if (!condition) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // For non-admins, verify they have access to this loan
  if (!admin) {
    const { data: loan } = await adminClient
      .from('loans')
      .select('id, loan_officer_id, loan_processor_id, loan_processor_id_2, underwriter_id')
      .eq('id', condition.loan_id)
      .single()
    if (!loan) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const hasAccess =
      (lo && loan.loan_officer_id === lo.id) ||
      (lp && (loan.loan_processor_id === lp.id || loan.loan_processor_id_2 === lp.id)) ||
      (uw && loan.underwriter_id === uw.id)

    if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await adminClient
    .from('conditions')
    .update({ category: safeCategory })
    .eq('id', conditionId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Audit log
  try {
    const fromLabel = condition.category ?? 'Uncategorized'
    const toLabel = safeCategory ?? 'Uncategorized'
    await adminClient.from('loan_events').insert({
      loan_id: condition.loan_id,
      event_type: 'condition_category_changed',
      description: `Condition "${condition.title}" moved from ${fromLabel} to ${toLabel}`,
    })
  } catch (err) { console.error('Event log error:', err) }

  return NextResponse.json({ success: true })
}
