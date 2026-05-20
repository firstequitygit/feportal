import { redirect } from 'next/navigation'

export default function SetPasswordPage() {
  // Legacy invite endpoint. Direct sign-in is now via /auth/callback;
  // any users who land here from old invite emails get redirected to login.
  redirect('/login')
}
