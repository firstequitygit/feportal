import Link from 'next/link'

export const metadata = { title: 'Application Received' }

const STEPS = [
  { n: 1, title: 'We review your application', body: 'Our team reviews your submission, usually within one business day.' },
  { n: 2, title: 'Your loan officer reaches out', body: 'They confirm details and walk you through next steps and required documents.' },
  { n: 3, title: 'Move toward closing', body: 'Track progress, upload documents, and message your team from your portal.' },
]

export default function SubmittedPage() {
  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[#1F5D8F]/10">
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-[#1F5D8F]" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h1 className="mb-2 text-2xl font-semibold text-[#1F5D8F]">Application received</h1>
        <p className="text-slate-600">Thank you. Your application is in and our team will be in touch.</p>

        <div className="my-6 rounded-xl bg-[#1F5D8F]/5 p-5 text-left">
          <p className="text-sm font-semibold text-[#1F5D8F]">Check your email to activate your portal account</p>
          <p className="mt-1 text-sm text-slate-600">
            We just emailed you a secure link to activate your account, where you can track your loan,
            upload documents, and message your team.
          </p>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">What happens next</h2>
        <ol className="space-y-4">
          {STEPS.map(s => (
            <li key={s.n} className="flex gap-4">
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[#1F5D8F] text-sm font-semibold text-white">{s.n}</span>
              <div>
                <p className="font-medium text-slate-900">{s.title}</p>
                <p className="text-sm text-slate-600">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <p className="mt-8 text-center text-sm text-slate-500">
        Already have a portal account? <Link href="/login" className="font-medium text-[#1F5D8F] underline">Sign in</Link>
      </p>
    </div>
  )
}
