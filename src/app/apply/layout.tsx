import { Fraunces, Geist, Caveat } from "next/font/google"

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["SOFT", "WONK", "opsz"],
})
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
})
const caveat = Caveat({
  subsets: ["latin"],
  variable: "--font-caveat",
  display: "swap",
  weight: ["500", "600"],
})

export default function ApplyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${fraunces.variable} ${geist.variable} ${caveat.variable} apply-theme min-h-screen`}>
      <header className="border-b border-[var(--apply-border)] bg-[var(--apply-surface)]">
        <div className="mx-auto max-w-4xl px-6 py-8">
          <div className="text-xs uppercase tracking-[0.22em] text-[var(--apply-ink-muted)] mb-1">
            First Equity Funding
          </div>
          <h1
            className="text-2xl font-[var(--font-display)] text-[var(--apply-ink)]"
            style={{ fontVariationSettings: "'opsz' 24, 'SOFT' 20" }}
          >
            Loan Application
          </h1>
        </div>
      </header>
      {children}
    </div>
  )
}
