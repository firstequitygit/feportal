'use client'

import { DataGrid, type DataGridColumn } from '@/components/data-grid'

export interface VendorRow {
  id: string
  name: string
  type: 'title' | 'insurance' | 'appraisal'
  emails: string[]
  phones: string[]
  loan_count: number
  loan_ids: string[]
  loan_addresses: string[]
}

const TYPE_LABEL: Record<VendorRow['type'], string> = {
  title: 'Title',
  insurance: 'Insurance',
  appraisal: 'Appraisal',
}

export function LoVendorsGrid({ initialRows }: { initialRows: VendorRow[] }) {
  const columns: DataGridColumn<VendorRow>[] = [
    {
      id: 'name', label: 'Name', filterKind: 'contains', alwaysVisible: true,
      accessor: (r) => r.name,
      cell: (r) => <span className="text-sm font-medium text-gray-900">{r.name}</span>,
      width: 'w-56',
    },
    {
      id: 'type', label: 'Type', filterKind: 'multi',
      filterOptions: [
        { label: 'Title', value: 'title' },
        { label: 'Insurance', value: 'insurance' },
        { label: 'Appraisal', value: 'appraisal' },
      ],
      accessor: (r) => r.type,
      cell: (r) => {
        const colors = {
          title: 'bg-blue-50 text-blue-700',
          insurance: 'bg-purple-50 text-purple-700',
          appraisal: 'bg-amber-50 text-amber-700',
        } as const
        return <span className={`text-xs px-2 py-0.5 rounded-full ${colors[r.type]}`}>{TYPE_LABEL[r.type]}</span>
      },
      width: 'w-28',
    },
    {
      id: 'emails', label: 'Emails', filterKind: 'contains',
      accessor: (r) => r.emails.join(', '),
      cell: (r) => <span className="text-sm text-gray-700">{r.emails.join(', ') || '—'}</span>,
      width: 'w-64',
    },
    {
      id: 'phones', label: 'Phones', filterKind: 'contains',
      accessor: (r) => r.phones.join(', '),
      cell: (r) => <span className="text-sm text-gray-700">{r.phones.join(', ') || '—'}</span>,
      width: 'w-48',
    },
    {
      id: 'loan_count', label: 'Loans', filterKind: 'range',
      accessor: (r) => r.loan_count,
      cell: (r) => (
        <details>
          <summary className="text-sm tabular-nums cursor-pointer hover:text-primary list-none">
            {r.loan_count}
          </summary>
          <ul className="mt-1 space-y-0.5">
            {r.loan_ids.map((lid, i) => (
              <li key={lid}>
                <a href={`/loan-officer/loans/${lid}`} className="text-xs text-primary hover:underline">
                  {r.loan_addresses[i] ?? '(no address)'}
                </a>
              </li>
            ))}
          </ul>
        </details>
      ),
      width: 'w-32',
    },
  ]

  return (
    <DataGrid
      rows={initialRows}
      columns={columns}
      defaultVisibleColumns={['name', 'type', 'emails', 'phones', 'loan_count']}
      emptyState="No vendors across your active loans yet."
    />
  )
}
