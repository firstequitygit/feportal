// Server-rendered Attorney Submission Summary PDF. Mirrors the
// Term Sheet / Committee Review endpoints — fetches loan + details,
// pulls the UW's live notes from the query string, returns a true
// downloadable file. Auth-gated to any staff role.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { renderAttorneySubmissionPdf } from '@/lib/pdf/attorney-submission-pdf'

export const runtime = 'nodejs'

async function isStaff(authUserId: string): Promise<boolean> {
  const adminClient = createAdminClient()
  const [
    { data: adminUser },
    { data: lo },
    { data: lp },
    { data: uw },
  ] = await Promise.all([
    adminClient.from('admin_users').select('id').eq('auth_user_id', authUserId).maybeSingle(),
    adminClient.from('loan_officers').select('id').eq('auth_user_id', authUserId).maybeSingle(),
    adminClient.from('loan_processors').select('id').eq('auth_user_id', authUserId).maybeSingle(),
    adminClient.from('underwriters').select('id').eq('auth_user_id', authUserId).maybeSingle(),
  ])
  return !!(adminUser || lo || lp || uw)
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await isStaff(user.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const adminClient = createAdminClient()

  const { data: loan } = await adminClient
    .from('loans')
    .select(`
      property_address, loan_number, loan_type, term_months, entity_name, estimated_closing_date,
      borrowers!borrower_id(full_name),
      borrower_2:borrowers!borrower_id_2(full_name),
      borrower_3:borrowers!borrower_id_3(full_name),
      borrower_4:borrowers!borrower_id_4(full_name)
    `)
    .eq('id', id)
    .single()
  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })

  const { data: details } = await adminClient
    .from('loan_details')
    .select('title_company, title_contact_name, title_email, title_phone')
    .eq('loan_id', id)
    .maybeSingle()

  const borrower = loan.borrowers as unknown as { full_name: string | null } | null
  const co1 = (loan as unknown as { borrower_2: { full_name: string | null } | null }).borrower_2
  const co2 = (loan as unknown as { borrower_3: { full_name: string | null } | null }).borrower_3
  const co3 = (loan as unknown as { borrower_4: { full_name: string | null } | null }).borrower_4
  const coBorrowerNames = [co1?.full_name, co2?.full_name, co3?.full_name]
    .filter((x): x is string => !!x)

  const pdf = await renderAttorneySubmissionPdf({
    propertyAddress: loan.property_address,
    loanNumber: loan.loan_number,
    loanType: loan.loan_type,
    termMonths: loan.term_months,
    borrowerName: borrower?.full_name ?? null,
    coBorrowerNames,
    entityName: loan.entity_name,
    titleCompany: details?.title_company ?? null,
    titleContactName: details?.title_contact_name ?? null,
    titleEmail: details?.title_email ?? null,
    titlePhone: details?.title_phone ?? null,
    estimatedClosingDate: loan.estimated_closing_date,
  })

  const safeFileSeed =
    (borrower?.full_name ?? loan.entity_name ?? loan.loan_number ?? id)
      .replace(/[^a-zA-Z0-9-_ ]/g, '')
      .trim()
      .replace(/\s+/g, '_')
  const filename = `Attorney_Submission_${safeFileSeed || 'loan'}.pdf`

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
