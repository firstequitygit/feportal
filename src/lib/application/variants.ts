import type {
  ApplicationData, FieldDef,
} from '@/lib/application-fields'
import {
  BORROWER_FIELDS, PRIMARY_EXTRA_FIELDS, DEAL_FIELDS, UNIT_FIELDS,
  DECLARATION_FIELDS, HMDA_FIELDS, EXPERIENCE_FIELDS,
} from '@/lib/application-fields'

export type VariantKind = 'borrower' | 'broker'
export type { ApplicationData }

export interface VariantFieldArrays {
  borrowerFields: FieldDef[]
  primaryExtraFields: FieldDef[]
  dealFields: FieldDef[]
  unitFields: FieldDef[]
  experienceFields: FieldDef[]
  declarationFields: FieldDef[]
  hmdaFields: FieldDef[]
}

export interface VariantEndpoints {
  draftPost: string
  draftPatch: string
  submit: string
  testSubmit: string
  upload: string
}

export interface VariantBranding {
  logoSrc: string
  titleText: string
  subtitle?: string
  primaryColor?: string
}

export interface VariantCopy {
  saveAndFinishLaterToast: string
  submitButtonLabel: string
  finalStepHeading: string
  step5AttestationLabel?: string
  step5AttestationBody?: string
}

export interface VariantFeatures {
  showTestMode: boolean
  autosaveEnabled: boolean
  createDraftOnLoad: boolean
  prefillFromAuthenticatedUser: boolean
  sendBorrowerToAuthorize: 'auto' | 'broker-forwards'
  duplicateAccountBehavior: 'block' | 'warn'
}

export interface VariantStorageKeys {
  testMode: string
  testData: string
  testOverrides: string
}

export interface VariantRedirects {
  afterSubmit: string
}

export interface VariantConfig {
  kind: VariantKind
  fieldArrays: VariantFieldArrays
  endpoints: VariantEndpoints
  branding: VariantBranding
  copy: VariantCopy
  redirects: VariantRedirects
  features: VariantFeatures
  storageKeys: VariantStorageKeys
}

/** Captures today's borrower behavior verbatim. Anything that branches on
 *  variant kind reads from here so the broker variant can ship without
 *  changing the borrower experience. */
export const BORROWER_VARIANT: VariantConfig = {
  kind: 'borrower',
  fieldArrays: {
    borrowerFields: BORROWER_FIELDS,
    primaryExtraFields: PRIMARY_EXTRA_FIELDS,
    dealFields: DEAL_FIELDS,
    unitFields: UNIT_FIELDS,
    experienceFields: EXPERIENCE_FIELDS,
    declarationFields: DECLARATION_FIELDS,
    hmdaFields: HMDA_FIELDS,
  },
  endpoints: {
    draftPost: '/api/apply/draft',
    draftPatch: '/api/apply/draft',
    submit: '/api/apply/submit',
    testSubmit: '/api/apply/test-submit',
    upload: '/api/apply/upload',
  },
  branding: {
    logoSrc: '/logo.png',
    titleText: 'Loan Application',
  },
  copy: {
    saveAndFinishLaterToast: "Saved. Use the link in your earlier email to come back any time.",
    submitButtonLabel: 'Submit Application',
    finalStepHeading: 'Submit',
  },
  redirects: {
    afterSubmit: '/apply/submitted',
  },
  features: {
    showTestMode: true,
    autosaveEnabled: true,
    createDraftOnLoad: false,
    prefillFromAuthenticatedUser: false,
    sendBorrowerToAuthorize: 'auto',
    duplicateAccountBehavior: 'block',
  },
  // Borrower keeps the legacy unprefixed keys so an admin's saved test overrides
  // survive this refactor. Broker variant uses prefixed keys to avoid bleed.
  storageKeys: {
    testMode: 'fe-apply-test-mode',
    testData: 'fe-apply-test-data',
    testOverrides: 'fe-apply-test-overrides',
  },
}

/** Client-side variant lookup. Server components pass `variantKind` as a string
 *  prop (functions inside `VariantConfig` can't cross the server→client wire);
 *  the client wizard reads the config from here. */
export const VARIANTS_BY_KIND: Record<VariantKind, VariantConfig> = {
  borrower: BORROWER_VARIANT,
  // BROKER_VARIANT lands in PR 3; falling back to borrower keeps the type happy
  // until that ships. A broker route shouldn't hit this slot before PR 3.
  broker: BORROWER_VARIANT,
}
