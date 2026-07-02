// Preview one of the fixed e-sign forms exactly as it would be sent:
// the staff-typed fill values stamped on, plus visible dashed outlines
// where every BoldSign field (signature, date, borrower-completed
// boxes) will sit. Returns the PDF inline; nothing is sent or stored.
// Staff-only, same gate as the send route.

import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEsignForm } from '@/lib/esign/forms'
import { renderFormPreview, drawFieldOutlines } from '@/lib/esign/fill-form'
import { buildTermSheetPackage } from '@/lib/esign/term-sheet-package'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()
  const [{ data: admin }, { data: lo }, { data: lp }, { data: uw }] = await Promise.all([
    adminClient.from('admin_users').select('id').eq('auth_user_id', user.id).maybeSingle(),
    adminClient.from('loan_officers').select('id').eq('auth_user_id', user.id).maybeSingle(),
    adminClient.from('loan_processors').select('id').eq('auth_user_id', user.id).maybeSingle(),
    adminClient.from('underwriters').select('id').eq('auth_user_id', user.id).maybeSingle(),
  ])
  if (!admin && !lo && !lp && !uw) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { formKey, values, loanId } = (await req.json().catch(() => ({}))) as {
    formKey?: string; values?: Record<string, string>; loanId?: string
  }

  try {
    let pdf: Buffer
    if (formKey === 'term_sheet') {
      // Generated package: rendered Term Sheet + W-9 last page, with
      // outlines drawn where every BoldSign field will sit.
      if (!loanId) return NextResponse.json({ error: 'Pick a loan to preview the Term Sheet.' }, { status: 400 })
      const pkg = await buildTermSheetPackage(adminClient, loanId)
      if ('error' in pkg) return NextResponse.json({ error: pkg.error }, { status: pkg.status })
      pdf = await drawFieldOutlines(pkg.pdf, pkg.fields)
    } else {
      const form = formKey ? getEsignForm(formKey) : undefined
      if (!form) return NextResponse.json({ error: 'Unknown form' }, { status: 400 })
      const raw = fs.readFileSync(path.join(process.cwd(), 'public', 'esign-forms', form.file))
      pdf = await renderFormPreview(raw, form, values ?? {})
    }
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${formKey}_preview.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[esign] form preview failed:', err)
    return NextResponse.json({ error: 'Could not render the preview.' }, { status: 500 })
  }
}
