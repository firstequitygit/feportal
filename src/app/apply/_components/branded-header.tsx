'use client'
import Image from "next/image"
import { Lock, ShieldCheck, Clock } from "lucide-react"
import { useSearchParams } from "next/navigation"

/** Top-of-page branded header for /apply. Renders the FEF logo + wordmark on
 *  top and the three security badges below. When the page is loaded with
 *  ?embed=1 (i.e. inside a WordPress iframe), the logo+wordmark strip hides
 *  to avoid double-branding with the host site - but the security badges
 *  persist on every step because they're the only trust signal a user sees
 *  inside the iframe. Passing ?header=1 alongside ?embed=1 opts back into the
 *  logo+wordmark strip for hosts that want the FEF branding shown in the iframe. */
export function BrandedHeader() {
  const searchParams = useSearchParams()
  const embed = searchParams.get('embed') === '1'
  const showHeader = searchParams.get('header') === '1'

  return (
    <>
      {(!embed || showHeader) && (
        <>
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
        </>
      )}
      <div className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-x-4 gap-y-1 px-6 py-2 text-xs text-gray-600">
          <span className="inline-flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5 shrink-0 text-[#1F5D8F]" aria-hidden />
            Bank-grade encryption
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[#1F5D8F]" aria-hidden />
            No credit check until you authorize
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 shrink-0 text-[#1F5D8F]" aria-hidden />
            ~10-minute application
          </span>
        </div>
      </div>
    </>
  )
}
