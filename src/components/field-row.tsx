interface Props {
  label: string
  children: React.ReactNode
}

/**
 * Two-column "label · value" row used in Loan Summary cards.
 * Children render on the right, label on the left.
 */
export function FieldRow({ label, children }: Props) {
  return (
    <div className="flex justify-between items-center gap-3">
      <span className="text-gray-500">{label}</span>
      {children}
    </div>
  )
}
