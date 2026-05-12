'use client'

interface Props {
  count: number
  onClear: () => void
  saving?: boolean
  error?: string | null
  children: React.ReactNode
}

export function BulkActionBar({ count, onClear, saving, error, children }: Props) {
  if (count === 0) return null
  return (
    <div className="fixed bottom-0 inset-x-0 md:left-60 z-30 px-4 md:px-8 pb-4 pointer-events-none">
      <div className="max-w-5xl mx-auto pointer-events-auto">
        <div className="bg-gray-900 text-white rounded-lg shadow-xl px-4 py-3 flex items-center gap-3 flex-wrap">
          <span className="text-sm font-semibold whitespace-nowrap">
            {count} selected
          </span>
          <div className="hidden sm:block h-4 w-px bg-gray-700" />
          <div className={`flex items-center gap-2 flex-wrap ${saving ? 'opacity-50 pointer-events-none' : ''}`}>
            {children}
          </div>
          {error && (
            <span className="text-xs text-red-300 ml-2">{error}</span>
          )}
          <button
            onClick={onClear}
            disabled={saving}
            className="ml-auto text-xs text-gray-400 hover:text-white transition-colors disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  )
}

export function BulkActionButton({
  onClick, disabled, children,
}: {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-sm bg-white text-gray-900 hover:bg-gray-100 px-3 py-1.5 rounded font-medium disabled:opacity-50 transition-colors whitespace-nowrap"
    >
      {children}
    </button>
  )
}
