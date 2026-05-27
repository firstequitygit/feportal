import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from '@/lib/impersonate'

// PATCH — Loan Processors can edit broker contact details for brokers on
// any of their loans (either LP slot). Email change blocked for brokers
// with portal logins.
export async function PATCH(req: NextRequest) {
  const block = await assertNotImpersonating()
  if (block) return block
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()
  const { data: lp } = await adminClient
    .from('loan_processors').select('id, is_ops_manager').eq('auth_user_id', user.id).single()
  if (!lp) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, full_name, email, phone, company_name } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  if (!email?.trim()) return NextResponse.json({ error: 'Email is required' }, { status: 400 })

  // Ops managers can edit any broker, skipping the loan-ownership check.
  if (!lp.is_ops_manager) {
    const { data: ownedLoans } = await adminClient
      .from('loans').select('id')
      .or(`loan_processor_id.eq.${lp.id},loan_processor_id_2.eq.${lp.id}`)
    const ownedIds = (ownedLoans ?? []).map(l => l.id)
    if (ownedIds.length === 0) return NextResponse.json({ error: 'Broker is not on any of your loans' }, { status: 403 })

    const { data: loanHit } = await adminClient
      .from('loans')
      .select('id')
      .in('id', ownedIds)
      .or(`broker_id.eq.${id},broker_id_2.eq.${id}`)
      .limit(1)
      .maybeSingle()
    if (!loanHit) return NextResponse.json({ error: 'Broker is not on any of your loans' }, { status: 403 })
  }

  const { data: current } = await adminClient
    .from('brokers').select('auth_user_id, email').eq('id', id).single()
  if (!current) return NextResponse.json({ error: 'Broker not found' }, { status: 404 })

  const updates: Record<string, string | null> = {
    full_name: full_name ?? null,
    phone: phone ?? null,
    company_name: company_name ?? null,
  }
  if (!current.auth_user_id || email.trim() === current.email) {
    updates.email = email.trim()
  } else if (email.trim() !== current.email) {
    return NextResponse.json({
      error: 'This broker has a portal login — changing their email would break their sign-in. Have them request a password reset or contact an admin.',
    }, { status: 400 })
  }

  const { error } = await adminClient.from('brokers').update(updates).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
