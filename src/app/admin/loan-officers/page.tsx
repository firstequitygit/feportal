import { redirect } from 'next/navigation'

export default function LoanOfficersRedirect() {
  redirect('/admin/settings/users/loan-officers')
}
