export default function ApplyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white px-6 py-4">
        <span className="text-lg font-semibold text-[#1F5D8F]">First Equity Funding — Loan Application</span>
      </header>
      {children}
    </div>
  )
}
