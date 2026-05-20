export default function ApplyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="mx-auto max-w-4xl px-6 py-5">
          <p className="text-sm font-semibold tracking-tight text-gray-900">First Equity Funding</p>
          <h1 className="text-xs uppercase tracking-wide text-gray-500 mt-0.5">Loan Application</h1>
        </div>
      </header>
      {children}
    </div>
  )
}
