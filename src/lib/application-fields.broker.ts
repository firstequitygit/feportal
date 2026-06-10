// Broker-only field definitions. Rendered as their own labeled block above
// the borrower section on Step 1 - see BROKER_VARIANT.fieldArrays.brokerInfoFields
// and the broker-info-block branch inside step1-borrower.tsx.

import type { FieldDef } from '@/lib/application-fields'

const REFERRAL_SOURCE_OPTIONS = [
  'Internet Search (Google, Bing, etc.)','Social Media (Facebook, Instagram, etc.)','YouTube',
  'Email Marketing','Text Message','Phone Call','Direct Mail','Networking Event',
  'Realtor Referral','Broker Referral','Other Referral','3rd Party Website','3rd Party Publication','Other',
] as const

export const BROKER_PRIMARY_EXTRA_FIELDS: FieldDef[] = [
  { name: 'broker_full_name', label: 'Broker Name', type: 'text', required: true, placeholder: 'Your full name' },
  { name: 'broker_email', label: 'Email', type: 'email', required: true, placeholder: 'you@brokerage.com' },
  { name: 'broker_phone', label: 'Phone', type: 'tel', required: true, placeholder: '(732) 555-0100' },
  { name: 'referral_source', label: 'Referral Source', type: 'select', required: true, options: REFERRAL_SOURCE_OPTIONS },
  { name: 'commission_split_percent', label: 'Commission Structure', type: 'text', placeholder: 'e.g. 50/50 split, 1% origination + 0.5%' },
]
