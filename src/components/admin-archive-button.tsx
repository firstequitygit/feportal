'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Archive, ArchiveRestore } from 'lucide-react'

interface Props {
  loanId: string
  archived: boolean
}

export function AdminArchiveButton({ loanId, archived }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)

  async function handleArchive() {
    if (!archived && !confirming) {
      setConfirming(true)
      return
    }
    setLoading(true)
    setConfirming(false)
    try {
      const res = await fetch('/api/admin/archive', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId, archived: !archived }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(archived ? 'Loan unarchived' : 'Loan archived')
        router.push('/admin')
        router.refresh()
      } else {
        toast.error(data.error ?? 'Failed to update loan')
      }
    } catch {
      toast.error('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (archived) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={handleArchive}
        disabled={loading}
        className="gap-1.5"
      >
        <ArchiveRestore className="w-3.5 h-3.5" />
        {loading ? 'Restoring…' : 'Unarchive Loan'}
      </Button>
    )
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">Archive this loan?</span>
        <Button
          size="sm"
          onClick={handleArchive}
          disabled={loading}
          className="bg-red-600 hover:bg-red-700 text-white border-0"
        >
          {loading ? 'Archiving…' : 'Confirm'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setConfirming(false)}
        >
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleArchive}
      className="gap-1.5 text-gray-500"
    >
      <Archive className="w-3.5 h-3.5" />
      Archive Loan
    </Button>
  )
}
