import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function verifyAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: admin } = await supabase
    .from('admin_users').select('id').eq('auth_user_id', user.id).single()
  return admin ? user : null
}

// DELETE a broker record. Removes the row from `brokers` (loans get their
// broker_id set to null via FK cascade — the borrower becomes the contact
// again) AND deletes the Supabase auth user if one is linked.
export async function DELETE(request: Request) {
  if (!await verifyAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const adminClient = createAdminClient()

  const { data: broker } = await adminClient
    .from('brokers').select('auth_user_id, email').eq('id', id).maybeSingle()
  if (!broker) return NextResponse.json({ error: 'Broker not found' }, { status: 404 })

  const { error } = await adminClient.from('brokers').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (broker.auth_user_id) {
    const { error: authErr } = await adminClient.auth.admin.deleteUser(broker.auth_user_id)
    if (authErr) console.error('Broker auth delete error:', authErr.message)
  }

  return NextResponse.json({ success: true })
}

// PATCH — Admins can edit broker contact details (name / company / email / phone).
// Email is locked if the broker has a portal login, to avoid breaking sign-in.
export async function PATCH(request: Request) {
  if (!await verifyAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { id, full_name, email, phone, company_name } = body as {
    id?: string; full_name?: string | null; email?: string; phone?: string | null; company_name?: string | null
  }
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  if (!email?.trim()) return NextResponse.json({ error: 'Email is required' }, { status: 400 })

  const adminClient = createAdminClient()

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
  } else {
    return NextResponse.json({
      error: 'This broker has a portal login — changing their email would break their sign-in. Have them request a password reset.',
    }, { status: 400 })
  }

  const { error } = await adminClient.from('brokers').update(updates).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
