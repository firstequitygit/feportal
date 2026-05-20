// Admin-triggered Airtable sync. POST with no body to sync all loans, or
// pass { loanId: '...' } to sync exactly one. Admin-only — same auth pattern
// as the rest of the admin endpoints.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncAllLoansToAirtable, syncLoanToAirtable } from '@/lib/airtable'

export const maxDuration = 300 // up to 5 min — full-base sync can be slow

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()
  const { data: admin } = await adminClient
    .from('admin_users').select('id').eq('auth_user_id', user.id).single()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const loanId = typeof body?.loanId === 'string' ? body.loanId : null

  try {
    if (loanId) {
      const result = await syncLoanToAirtable(loanId)
      return NextResponse.json({ ok: true, result })
    }
    const summary = await syncAllLoansToAirtable()
    return NextResponse.json({ ok: true, summary })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('Airtable sync failed:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
