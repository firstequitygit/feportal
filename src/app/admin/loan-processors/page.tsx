import { redirect } from 'next/navigation'

export default function LoanProcessorsRedirect() {
  redirect('/admin/settings/users/loan-processors')
}
