import { Lock } from "lucide-react"

export default function ApplyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="mx-auto max-w-4xl px-6 py-5">
          <p className="text-sm font-semibold tracking-tight text-gray-900">First Equity Funding</p>
          <h1 className="text-xs uppercase tracking-wide text-gray-500 mt-0.5">Loan Application</h1>
        </div>
      </header>
      <div className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-x-2 gap-y-1 px-6 py-2 text-xs text-gray-600">
          <Lock className="h-3.5 w-3.5 shrink-0 text-gray-500" aria-hidden />
          <span>Bank-grade encryption</span>
          <span aria-hidden className="hidden text-gray-300 sm:inline">·</span>
          <span>No credit check until you authorize</span>
          <span aria-hidden className="hidden text-gray-300 sm:inline">·</span>
          <span>~10-minute application</span>
        </div>
      </div>
      {children}
    </div>
  )
}
