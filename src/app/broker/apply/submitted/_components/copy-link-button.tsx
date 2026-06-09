'use client'
import { useState } from 'react'

export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        } catch {
          // Clipboard unavailable - user can still select the URL manually.
        }
      }}
      className="inline-flex h-9 items-center rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 transition-colors hover:border-[#1F5D8F] hover:text-[#1F5D8F]"
    >
      {copied ? 'Copied!' : 'Copy link'}
    </button>
  )
}
