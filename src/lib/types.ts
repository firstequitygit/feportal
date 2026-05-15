export type LoanType = 'Fix & Flip (Bridge)' | 'Rental (DSCR)' | 'New Construction'

export type PipelineStage =
  | 'New Application'
  | 'Processing'
  | 'Pre-Underwriting'
  | 'Underwriting'
  | 'Submitted'
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
  loan_processor_id_2: string | null   // FE supports up to 2 LPs per loan
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
  'New Application',
  'Processing',
  'Pre-Underwriting',
  'Underwriting',
  'Submitted',
  'Closed',
]

// Pipedrive stage ID → stage name (Pipeline 2: "Deals Pipeline")
export const PIPEDRIVE_STAGE_MAP: Record<number, PipelineStage> = {
  6:  'New Application',
  8:  'Processing',
  21: 'Pre-Underwriting',
  13: 'Underwriting',
  14: 'Submitted',
  15: 'Closed',
}

// Pipedrive custom field keys. `loanAmount` is intentionally NOT here
// because FE uses Pipedrive's default deal `value` field for loan
// amount (see pipedrive.ts normalizeDeal).
export const PIPEDRIVE_FIELDS = {
  loanType:           '7cdd062ec5dc7aa3db3eddca6b001adc95c65349', // "Loan Program"
  interestRate:       '85fa7baadd31237702f6db73c2ecf9df1a283371',
  ltv:                '81ee9eb3a931966811fea2b29fd25ecb83589b7e',
  arv:                '60fbb4db1daba589d00e0863c0ac2ed04838ae7e', // "Estimated After Repair Value (ARV)"
  rehabBudget:        '8a59c95daf85212e7c59590ba8b143a51b39e8b1', // "Estimated Renovation/Construction Budget"
  originationDate:    'cfe0e920f324a5112b0feaeba944cbfd290cf021',
  maturityDate:       '4fc9b3a9c8f30f36bf65f02a4f3ef6217410f629',
  entityName:         '7489edc6f996b044c8167c260f078c9b582c5b93',
  termMonths:         'fae3ac715ebab1d71ebe960d14b38bff2b9b5d78', // "Term (Months)"
  loanNumber:         'a6c952368dd9bdc9232d6dda871d3c55aa718071',
  rateLocked:         '95ffccc8689ae55b3bf20382cb71f0c85a5f5680', // "Locked?" yes-only enum
  rateLockExpiration: '4666749efdb317bc7794f478f02bb8c76801af7d',
  interestOnly:       'f0b4e7a479c1aa69c7d39b8a19925fd154920fc3', // enum Yes/No
  loanTypeII:         '6780eb1a6f081cabfd6248c03dd13152804233f5', // "Loan Purpose" (Purchase / Refi / etc.)
  propertyAddress:    '774f8922280288f08c94df16bf643d40a5da53f6', // structured address field
  closingDate:        'e150d1a8987dfe88c808d7c2121b9fe02f8a65fe', // "Closing Date" — scheduled/expected close, drives the Closings report
} as const

// Pipedrive "Loan Program" option ID → portal LoanType
export const PIPEDRIVE_LOAN_TYPE_MAP: Record<number, LoanType> = {
  82: 'Fix & Flip (Bridge)',
  83: 'Rental (DSCR)',
  85: 'New Construction',
}

// FE does not store borrower PII (SSN, DOB, citizenship, marital
// status) in Pipedrive — that data lives in Supabase only. Kept
// here as an empty const so existing imports don't break.
export const PIPEDRIVE_PERSON_FIELDS = {} as const
