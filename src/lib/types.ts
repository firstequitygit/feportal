export type LoanType = 'Bridge' | 'Fix & Flip' | 'New Construction' | 'DSCR'

export type PipelineStage =
  | 'New Loan / Listing'
  | 'Appraisal Paid'
  | 'Processing / Listed'
  | 'Underwriting / Contract'
  | 'Cleared to Close'
  | 'Closed'

export type ConditionStatus = 'Outstanding' | 'Received' | 'Satisfied' | 'Waived' | 'Rejected'
export type AssignedTo = 'borrower' | 'loan_officer' | 'loan_processor' | 'underwriter'
export type ConditionCategory = 'initial' | 'underwriting' | 'pre_close' | 'pre_funding'

export interface OutstandingCounts {
  you: number
  borrower: number
  team: number
  total: number
}

export const CONDITION_CATEGORIES: { value: ConditionCategory; label: string }[] = [
  { value: 'initial',     label: 'Initial Conditions' },
  { value: 'underwriting', label: 'Underwriting Conditions' },
  { value: 'pre_close',   label: 'Pre-Close Conditions' },
  { value: 'pre_funding', label: 'Pre-Funding Conditions' },
]

export interface Underwriter {
  id: string
  auth_user_id: string | null
  full_name: string
  email: string | null
  phone: string | null
  title: string | null
  created_at: string
}

export interface LoanProcessor {
  id: string
  auth_user_id: string | null
  full_name: string
  email: string | null
  phone: string | null
  title: string | null
  created_at: string
}

export interface LoanOfficer {
  id: string
  auth_user_id: string | null
  full_name: string
  email: string | null
  phone: string | null
  title: string | null
  created_at: string
}

export interface Borrower {
  id: string
  auth_user_id: string
  pipedrive_person_id: number | null
  email: string
  full_name: string | null
  entity_name: string | null
  phone: string | null
  created_at: string
}

export interface Loan {
  id: string
  pipedrive_deal_id: number
  borrower_id: string | null
  loan_officer_id: string | null
  loan_processor_id: string | null
  underwriter_id: string | null
  property_address: string | null
  loan_type: LoanType | null
  loan_amount: number | null
  interest_rate: number | null
  ltv: number | null
  arv: number | null
  rehab_budget: number | null
  term_months: number | null
  origination_date: string | null
  maturity_date: string | null
  estimated_closing_date: string | null
  entity_name: string | null
  loan_number: string | null
  rate_locked_days: string | null
  rate_lock_expiration_date: string | null
  interest_only: string | null
  loan_type_ii: string | null
  pipeline_stage: PipelineStage | null
  underwriter: string | null
  last_synced_at: string | null
  archived: boolean
  created_at: string
}

export interface Condition {
  id: string
  loan_id: string
  title: string
  description: string | null
  status: ConditionStatus
  assigned_to: AssignedTo
  category: ConditionCategory | null
  rejection_reason: string | null
  response: string | null
  created_at: string
  updated_at: string
}

export interface Document {
  id: string
  loan_id: string
  condition_id: string | null
  uploaded_by_borrower_id: string | null
  file_name: string
  file_path: string
  file_size: number | null
  created_at: string
}

export interface ConditionTemplate {
  id: string
  title: string
  description: string | null
  loan_type: LoanType | null
  assigned_to: AssignedTo
  category: ConditionCategory | null
}

export const PIPELINE_STAGES: PipelineStage[] = [
  'New Loan / Listing',
  'Appraisal Paid',
  'Processing / Listed',
  'Underwriting / Contract',
  'Cleared to Close',
  'Closed',
]

// Pipedrive stage ID → stage name mapping
export const PIPEDRIVE_STAGE_MAP: Record<number, PipelineStage> = {
  11: 'New Loan / Listing',
  12: 'Appraisal Paid',
  13: 'Processing / Listed',
  14: 'Underwriting / Contract',
  15: 'Cleared to Close',
  16: 'Closed',
}

// Pipedrive custom field keys
export const PIPEDRIVE_FIELDS = {
  loanAmount:      '2ef1830d0d42d860dede5007ba270e82ca399d56',
  loanType:        '4d80cb2bd9eaa2458bf861a73e25d04780be908c',
  interestRate:    '89de0abaa5874e54f20ea37026381570430ce875',
  ltv:             '32bfa19367a58ace64090245576c37b0576fa16a',
  arv:             'f51d051277a33ee93735e31c238adcfa4e185b8e',
  rehabBudget:     'f9b1a8269007fd82b8b2878bc81510adcc42318d',
  originationDate: '2208204bb9abdf1f6a08df9b87a4c49d0beec8db',
  maturityDate:    '76fa896d328f650b3f7a166adf8f805d7bc46291',
  entityName:      'f629b98d322cd7e74b2646cced8f7c686005ed9c',
  termMonths:      '7de7295425978aab4993c0d8a50b340d1d1bc996',
  loanNumber:          '888213c45074c9e3c13ba00efd17ae277cdbd858',
  rateLocked:          '41af10626f57ab73efec7d741c6283acf38ed7ce',
  rateLockExpiration:  'c23817c164e85de9662ddd209e646ff51b527955',
  interestOnly:        '3dd9aa35e80ac997caa95629475f44d1e2fc2e80',
  loanTypeII:          '3517032a252daff9184085e28590bf87ac072d1e',
} as const

// Pipedrive Loan Type option ID → label
export const PIPEDRIVE_LOAN_TYPE_MAP: Record<number, LoanType> = {
  35: 'Bridge',
  36: 'Fix & Flip',
  37: 'New Construction',
  38: 'DSCR',
}

// Pipedrive Person custom field keys (used by JotForm intake to capture
// PII that lives with the borrower record, not the deal)
export const PIPEDRIVE_PERSON_FIELDS = {
  ssn:           'ba31207548a48e6eafdfa95ab1383a9be621d984',
  birthDate:     '0594a1280c281d893b51f8652ef5afadb18d8f7a',
  usCitizen:     'e91c0f98ae2bcac5e73038e95c123dcaf43c6732',
  maritalStatus: '9ddd683dff60cf2e9ec695de22e952fd5932ac06',
} as const
