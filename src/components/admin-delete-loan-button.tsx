'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function AdminDeleteLoanButton({ loanId }: { loanId: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleDelete() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/loans/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Loan permanently deleted')
        router.refresh()
      } else {
        toast.error(data.error ?? 'Failed to delete loan')
      }
    } catch {
      toast.error('Network error. Please try again.')
    } finally {
      setLoading(false)
      setConfirming(false)
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 whitespace-nowrap">Permanently delete?</span>
        <Button
          size="sm"
          onClick={handleDelete}
          disabled={loading}
          className="bg-red-600 hover:bg-red-700 text-white border-0 text-xs h-7 px-2.5"
        >
          {loading ? 'Deleting…' : 'Yes, Delete'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setConfirming(false)}
          disabled={loading}
          className="text-xs h-7 px-2.5"
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
      onClick={() => setConfirming(true)}
      className="gap-1.5 text-red-500 hover:text-red-600 hover:border-red-300 hover:bg-red-50 text-xs h-7 px-2.5"
    >
      <Trash2 className="w-3.5 h-3.5" />
      Delete
    </Button>
  )
}
