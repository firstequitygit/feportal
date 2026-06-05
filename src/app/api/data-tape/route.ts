// JSON endpoint that powers the Data Tape page. Pulled out of the
// page's server component so SSR can stay tiny — auth-check + shell
// only — and the heavy fetch runs through a normal API route the
// client polls after mount. Avoids the per-function response-size
// trap that 500'd the SSR'd version of this page.
//
// Auth: any staff role (admin / LO / LP / UW). Borrowers + brokers
// don't see the data tape; the page's nav link isn't even rendered
// in those variants, but defend in depth here too.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchDataTape } from '@/lib/fetch-data-tape'

export const dynamic = 'force-dynamic'

export async function GET() {
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

  const result = await fetchDataTape(adminClient)
  return NextResponse.json(result)
}
