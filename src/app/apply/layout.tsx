import Image from "next/image"
import { Lock } from "lucide-react"

export default function ApplyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Thin navy accent stripe */}
      <div className="h-1 bg-[#1F5D8F]" aria-hidden />
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-center gap-3 px-6 py-3">
          <Image
            src="/logo-symbol.png"
            alt="First Equity Funding"
            width={40}
            height={40}
            priority
            className="h-9 w-auto"
          />
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-tight text-[#1F5D8F]">
              First Equity Funding
            </span>
            <span className="text-[11px] uppercase tracking-wider text-gray-500">
              Loan Application
            </span>
          </div>
        </div>
      </header>
      <div className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-x-2 gap-y-1 px-6 py-2 text-xs text-gray-600">
          <Lock className="h-3.5 w-3.5 shrink-0 text-[#1F5D8F]" aria-hidden />
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
