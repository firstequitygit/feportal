// Server-rendered Conditions List PDF — a true downloadable file.
// Staff-gated (admin / LO / LP / UW). Mirrors the on-screen
// /conditions-report/[id] page.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { renderConditionsReportPdf } from '@/lib/pdf/conditions-report-pdf'
import { fetchConditionNotesForLoan } from '@/lib/fetch-condition-notes'
import { formatLoanName } from '@/lib/format-loan-name'
import type { Condition } from '@/lib/types'

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

  const [{ data: loan }, { data: conditions }, notesByCondition] = await Promise.all([
    adminClient
      .from('loans')
      .select('property_address, loan_number, entity_name, borrowers!borrower_id(full_name)')
      .eq('id', id)
      .single(),
    adminClient
      .from('conditions')
      .select('*')
      .eq('loan_id', id)
      .order('created_at', { ascending: true }),
    fetchConditionNotesForLoan(adminClient, id),
  ])

  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })

  const borrower = loan.borrowers as unknown as { full_name: string | null } | null
  const loanName = formatLoanName({
    borrowerName: borrower?.full_name ?? null,
    propertyAddress: loan.property_address,
    loanNumber: loan.loan_number,
  })

  const pdf = await renderConditionsReportPdf({
    loanName,
    loanNumber: loan.loan_number,
    propertyAddress: loan.property_address,
    conditions: (conditions ?? []) as Condition[],
    notesByCondition,
  })

  const safeFileSeed =
    (borrower?.full_name ?? loan.entity_name ?? loan.loan_number ?? id)
      .replace(/[^a-zA-Z0-9-_ ]/g, '')
      .trim()
      .replace(/\s+/g, '_')
  const filename = `Conditions_${safeFileSeed || 'loan'}.pdf`

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
