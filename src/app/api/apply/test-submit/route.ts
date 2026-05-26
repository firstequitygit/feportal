import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  BORROWER_FIELDS, PRIMARY_EXTRA_FIELDS, DEAL_FIELDS, UNIT_FIELDS,
  DECLARATION_FIELDS, HMDA_FIELDS, dscrUnitCount, isRequired,
  type ApplicationData,
} from '@/lib/application-fields'
import { renderApplicationPdf } from '@/lib/pdf/application-pdf'
import { sendApplicationTestNotifications, type TestOverrides } from '@/lib/apply-notify-test'
import { rateLimit, clientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

async function requireAdmin(): Promise<string | null> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const admin = createAdminClient()
    const { data } = await admin
      .from('admin_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle()
    return data ? user.id : null
  } catch {
    return null
  }
}

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return true
  if (Array.isArray(v) && v.length === 0) return true
  return false
}

function missingRequired(data: ApplicationData): string[] {
  const miss: string[] = []
  const primary = (data.primary as Record<string, unknown>) ?? {}
  for (const f of [...BORROWER_FIELDS, ...PRIMARY_EXTRA_FIELDS]) {
    if (isRequired(f, data, primary) && isEmpty(primary[f.name])) miss.push(`primary.${f.name}`)
  }
  for (const f of DEAL_FIELDS) {
    if (isRequired(f, data) && isEmpty(data[f.name])) miss.push(f.name)
  }
  const uc = dscrUnitCount(data)
  if (uc > 0) {
    const units = Array.isArray(data.units) ? (data.units as Record<string, unknown>[]) : []
    for (let i = 0; i < uc; i++) {
      const scope = (units[i] ?? {}) as ApplicationData
      for (const f of UNIT_FIELDS) {
        if (isRequired(f, data, scope) && isEmpty(scope[f.name as keyof typeof scope])) miss.push(`unit${i + 1}.${f.name}`)
      }
    }
  }
  const cobs: Record<string, unknown>[] = Array.isArray(data.co_borrowers)
    ? (data.co_borrowers as Record<string, unknown>[]) : []
  for (let i = 0; i < cobs.length; i++) {
    const scope = cobs[i]
    for (const f of BORROWER_FIELDS) {
      if (isRequired(f, data, scope) && isEmpty(scope[f.name])) miss.push(`coborrower${i + 1}.${f.name}`)
    }
  }
  for (const f of [...DECLARATION_FIELDS, ...HMDA_FIELDS]) {
    if (isRequired(f, data) && isEmpty(data[f.name])) miss.push(f.name)
  }
  if (isEmpty(data.auth_signature)) miss.push('auth_signature')
  return miss
}

function validEmail(s: unknown): s is string {
  return typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)
}

export async function POST(req: NextRequest) {
  const adminUserId = await requireAdmin()
  if (!adminUserId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (!rateLimit(`test-submit:${adminUserId}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: {
    data?: ApplicationData
    overrides?: Partial<TestOverrides>
    scenarioLabel?: string | null
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  if (!body.data || typeof body.data !== 'object') {
    return NextResponse.json({ error: 'Missing data' }, { status: 400 })
  }
  const o = body.overrides ?? {}
  if (!validEmail(o.borrowerEmail) || !validEmail(o.processingInbox) || !validEmail(o.loEmail)) {
    return NextResponse.json({ error: 'All three override email addresses are required and must be well-formed.' }, { status: 400 })
  }
  const overrides: TestOverrides = {
    borrowerEmail: o.borrowerEmail,
    processingInbox: o.processingInbox,
    loEmail: o.loEmail,
  }

  const miss = missingRequired(body.data)
  if (miss.length) {
    return NextResponse.json({ error: 'Some required fields are missing', missing: miss }, { status: 422 })
  }

  const pdf = await renderApplicationPdf(body.data)
  const result = await sendApplicationTestNotifications({
    data: body.data,
    pdf,
    overrides,
    scenarioLabel: typeof body.scenarioLabel === 'string' ? body.scenarioLabel : null,
  })

  return NextResponse.json({
    success: true,
    recipients: { borrower: result.borrower, internal: result.internal },
    pdfBytes: result.pdfBytes,
    scenario: body.scenarioLabel ?? null,
  })
}
