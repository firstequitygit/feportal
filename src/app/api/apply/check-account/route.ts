import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit, clientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

/** Email-based existence check for the duplicate-account gate at the start
 *  of /apply. Returns { hasAccount: boolean }. Intentionally does not leak
 *  any identifying info beyond the boolean — that's enough to gate the form
 *  and route the user to /login, but it doesn't help an attacker enumerate
 *  borrowers. Rate-limited to discourage that anyway. */
export async function POST(req: NextRequest) {
  if (!rateLimit(`check-account:${clientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: { email?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Bad JSON' }, { status: 400 })
  }
  const email = body.email?.trim().toLowerCase()
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('borrowers')
    .select('id')
    .ilike('email', email)
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('check-account query failed:', error.message)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
  }

  return NextResponse.json({ hasAccount: !!data })
}
