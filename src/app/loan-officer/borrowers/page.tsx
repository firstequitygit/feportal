import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { EditableContactList, type EditableContactRow } from '@/components/editable-contact-list'

export default async function LoanOfficerBorrowersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const { data: lo } = await adminClient
    .from('loan_officers').select('id, full_name').eq('auth_user_id', user.id).single()
  if (!lo) redirect('/login')

  // Pull every borrower across every slot of every loan assigned to this LO.
  const { data: rows } = await adminClient
    .from('loans')
    .select('borrower_id, borrower_id_2, borrower_id_3, borrower_id_4')
    .eq('loan_officer_id', lo.id)
    .eq('archived', false)

  // Tally how many loans each borrower id appears on (across all slots).
  const loanCountById = new Map<string, number>()
  for (const r of rows ?? []) {
    for (const id of [r.borrower_id, r.borrower_id_2, r.borrower_id_3, r.borrower_id_4]) {
      if (!id) continue
      loanCountById.set(id, (loanCountById.get(id) ?? 0) + 1)
    }
  }
  const ids = [...loanCountById.keys()]

  const { data: borrowers } = ids.length > 0
    ? await adminClient.from('borrowers').select('id, full_name, email, phone').in('id', ids).order('full_name')
    : { data: [] }

  const initial: EditableContactRow[] = (borrowers ?? []).map(b => {
    const count = loanCountById.get(b.id) ?? 0
    return {
      id: b.id,
      full_name: b.full_name,
      email: b.email,
      phone: b.phone,
      subtitle: count > 0 ? `On ${count} of your loan${count === 1 ? '' : 's'}` : null,
    }
  })

  return (
    <PortalShell userName={lo.full_name} userRole="Loan Officer" dashboardHref="/loan-officer/inbox" variant="loan-officer" maxWidth="max-w-3xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Borrowers</h2>
      <p className="text-sm text-gray-500 mb-6">
        Every borrower across every loan assigned to you. Click the pencil to correct
        a misspelling, update an email, or change a phone number.
      </p>
      <EditableContactList
        label="borrowers"
        apiPath="/api/loan-officer/borrowers"
        initialContacts={initial}
      />
    </PortalShell>
  )
}
