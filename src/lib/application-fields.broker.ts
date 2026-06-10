// Broker-only field definitions. Rendered as their own labeled block above
// the borrower section on Step 1 — see BROKER_VARIANT.fieldArrays.brokerInfoFields
// and the broker-info-block branch inside step1-borrower.tsx.

import type { FieldDef } from '@/lib/application-fields'

const COMMISSION_PAID_BY_OPTIONS = ['Borrower', 'Lender', 'Both'] as const

export const BROKER_PRIMARY_EXTRA_FIELDS: FieldDef[] = [
  { name: 'brokerage_name', label: 'Brokerage Name', type: 'text', required: true, placeholder: 'Acme Mortgage LLC' },
  { name: 'broker_email', label: 'Broker Email', type: 'email', required: true, placeholder: 'you@brokerage.com' },
  { name: 'broker_phone', label: 'Broker Phone', type: 'tel', required: true, placeholder: '(732) 555-0100' },
  { name: 'broker_license_number', label: 'NMLS / State License #', type: 'text', required: true, placeholder: '1234567' },
  { name: 'broker_license_state', label: 'License State', type: 'text', required: true, placeholder: 'NJ' },
  { name: 'commission_split_percent', label: 'Commission Split %', type: 'number', placeholder: 'e.g. 50' },
  { name: 'commission_paid_by', label: 'Commission Paid By', type: 'select', options: COMMISSION_PAID_BY_OPTIONS },
  { name: 'referral_source', label: 'Referral Source', type: 'select',
    options: ['Internet Search (Google, Bing, etc.)','Social Media (Facebook, Instagram, etc.)','YouTube','Email Marketing','Text Message','Phone Call','Direct Mail','Networking Event','Realtor Referral','Broker Referral','Other Referral','3rd Party Website','3rd Party Publication','Other'] },
]
