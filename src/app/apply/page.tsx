import { Suspense } from 'react'
import { Wizard } from './_components/wizard'

export const metadata = { title: 'Loan Application — First Equity Funding' }

export default function ApplyPage() {
  return (
    <Suspense>
      <Wizard initialData={{}} initialStep={1} initialToken={null} />
    </Suspense>
  )
}
