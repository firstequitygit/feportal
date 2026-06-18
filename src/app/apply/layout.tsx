'use client'
import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { BrandedHeader } from "./_components/branded-header"

function ApplyLayoutInner({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams()
  const embed = searchParams.get('embed') === '1'
  // Standalone /apply uses min-h-screen so the gray background fills the
  // viewport. Embedded /apply must NOT use viewport units (min-h-screen / vh):
  // the body would track the iframe height, get reported to the parent, resize
  // the iframe taller, and loop. The embedded gate sizes itself with a fixed
  // pixel band instead (see ApplyGate), which the height reporter sends to the
  // parent so the iframe matches the content exactly.
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
