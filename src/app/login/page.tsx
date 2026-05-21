import LoginClient from './login-client'

// Avoid prerender — the client component instantiates the Supabase browser
// client at module evaluation time, which throws at build time on Vercel
// when env vars aren't inlined into the worker context.
export const dynamic = 'force-dynamic'

export default function LoginPage() {
  return <LoginClient />
}
