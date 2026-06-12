'use client'

// Full property address line under the loan-page title, with a
// one-click copy button. The title only shows "Borrower — Street",
// so this is the one place staff can grab the complete address
// (street, city, state, ZIP) without opening the Loan Summary edit.

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

export function CopyableAddress({ address }: { address: string | null }) {
  const [copied, setCopied] = useState(false)
  const trimmed = address?.trim()
  if (!trimmed) return null

  async function copy() {
    if (!trimmed) return
    try {
      await navigator.clipboard.writeText(trimmed)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard unavailable (http / permissions) — the text is
      // select-all anyway, so manual copy still works.
    }
  }

  return (
    <p className="text-sm text-gray-600 mt-0.5 flex items-center gap-1.5">
      {/* select-all: one click selects the whole address for manual copy */}
      <span className="select-all">{trimmed}</span>
      <button
        type="button"
        onClick={copy}
        title="Copy full address"
        className="text-gray-400 hover:text-gray-600 transition-colors shrink-0"
      >
        {copied
          ? <Check className="w-3.5 h-3.5 text-green-600" />
          : <Copy className="w-3.5 h-3.5" />}
      </button>
    </p>
  )
}
