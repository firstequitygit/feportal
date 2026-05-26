import { redirect } from 'next/navigation'

export default function UnderwritersRedirect() {
  redirect('/admin/settings/users/underwriters')
}
