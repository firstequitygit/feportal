'use client'
import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { BrandedHeader } from "./_components/branded-header"

function ApplyLayoutInner({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams()
  const embed = searchParams.get('embed') === '1'
  // Standalone /apply uses min-h-screen so the gray background fills the
  // viewport. Embedded /apply must NOT, or the body grows to 100vh of the
  // iframe; that height gets reported to the parent, which resizes the
  // iframe taller, which makes 100vh larger, which makes the body taller -
  // the height reporter feedback loop that lets you scroll forever.
  return (
    <div className={embed ? "bg-gray-50" : "min-h-screen bg-gray-50"}>
      <BrandedHeader />
      {children}
    </div>
  )
}

export default function ApplyLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <ApplyLayoutInner>{children}</ApplyLayoutInner>
    </Suspense>
  )
}
