import { Suspense } from "react"
import { BrandedHeader } from "./_components/branded-header"

export default function ApplyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <Suspense>
        <BrandedHeader />
      </Suspense>
      {children}
    </div>
  )
}
