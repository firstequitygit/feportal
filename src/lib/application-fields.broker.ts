// Broker-only field definitions. Layered on top of the shared base via
// BROKER_VARIANT.fieldArrays.primaryExtraFields so the broker identity block
// renders at the top of Step 1, ahead of the shared primary-extra fields.

import type { FieldDef } from '@/lib/application-fields'

const COMMISSION_PAID_BY_OPTIONS = ['Borrower', 'Lender', 'Both'] as const

/** Broker identity block — rendered at the TOP of Step 1's primary-extra
 *  section so the broker fills out their own credentials first. */
export const BROKER_PRIMARY_EXTRA_FIELDS: FieldDef[] = [
  { name: 'brokerage_name', label: 'Brokerage Name', type: 'text', required: true, placeholder: 'Acme Mortgage LLC', section: 'Broker information' },
  { name: 'broker_license_number', label: 'NMLS / State License #', type: 'text', required: true, placeholder: '1234567', section: 'Broker information' },
  { name: 'broker_license_state', label: 'License State', type: 'text', required: true, placeholder: 'NJ', section: 'Broker information' },
  { name: 'broker_phone', label: 'Broker Phone', type: 'tel', required: true, placeholder: '(732) 555-0100', section: 'Broker information' },
  { name: 'commission_split_percent', label: 'Commission Split %', type: 'number', placeholder: 'e.g. 50', section: 'Broker information' },
  { name: 'commission_paid_by', label: 'Commission Paid By', type: 'select', options: COMMISSION_PAID_BY_OPTIONS, section: 'Broker information' },
  { name: 'referral_source', label: 'Referral Source', type: 'select',
    options: ['Internet Search (Google, Bing, etc.)','Social Media (Facebook, Instagram, etc.)','YouTube','Email Marketing','Text Message','Phone Call','Direct Mail','Networking Event','Realtor Referral','Broker Referral','Other Referral','3rd Party Website','3rd Party Publication','Other'],
    section: 'Broker information' },
]
