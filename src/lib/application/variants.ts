import type {
  ApplicationData, FieldDef,
} from '@/lib/application-fields'
import {
  BORROWER_FIELDS, PRIMARY_EXTRA_FIELDS, DEAL_FIELDS, UNIT_FIELDS,
  DECLARATION_FIELDS, HMDA_FIELDS, EXPERIENCE_FIELDS,
} from '@/lib/application-fields'
import { BROKER_PRIMARY_EXTRA_FIELDS } from '@/lib/application-fields.broker'

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

/** Broker certification text shown verbatim on Step 5 (broker variant) and
 *  persisted to loans.broker_attestation_text at submit so the wording the
 *  broker agreed to is frozen against future legal-copy changes. */
export const BROKER_ATTESTATION_BODY = `Broker Certification and Electronic Signature

By signing below, I, the undersigned mortgage broker, loan originator, or authorized representative ("Broker"), certify and acknowledge the following:

1. Authority. I am duly licensed (or exempt from licensure) in each jurisdiction in which I am offering or negotiating this loan, and I am authorized to submit this Application on behalf of the borrower(s) identified above ("Borrower").

2. Borrower Authorization. I have obtained Borrower's express permission to prepare and submit this Application to First Equity Funding ("Lender") and to share Borrower's information with Lender for the purpose of evaluating this loan request.

3. Accuracy and Good Faith. All information contained in this Application has been provided to me by Borrower or obtained from sources Borrower has authorized. I have completed this Application accurately and in good faith, to the best of my knowledge and belief, based on the information furnished to me. I have not knowingly omitted, altered, or misrepresented any material fact.

4. No Authority to Sign Borrower Disclosures. I understand and acknowledge that this certification authenticates only my own representations as Broker. I am not signing, and have no authority to sign, Borrower's Credit and Identity Authorization, demographic information disclosures, or any other disclosure that requires Borrower's own attestation. Borrower must independently complete and electronically sign the Credit Card and Borrower's Authorization Form, which Lender will provide to Borrower separately.

5. Federal Fraud Statutes. I understand that knowingly making any false, fictitious, or fraudulent statement or representation in connection with this Application may constitute a federal crime punishable by fine, imprisonment, or both, under 18 U.S.C. § 1014 and other applicable federal and state laws.

6. Compensation Disclosure. I will comply with all applicable laws and regulations governing the disclosure of broker compensation, including, where applicable, Regulation Z (12 C.F.R. § 1026.36) and any state-specific licensing or disclosure requirements.

7. Electronic Signature Consent. Under the federal Electronic Signatures in Global and National Commerce Act (15 U.S.C. § 7001 et seq.) and any applicable state version of the Uniform Electronic Transactions Act, I consent to the use of an electronic signature and agree that typing my full legal name below and clicking "Submit" has the same legal effect as my handwritten signature.

8. Privacy. I have informed Borrower that Lender's evaluation of this Application is subject to Lender's privacy policy, and Borrower has consented to Lender's collection and use of Borrower's information as described in that policy.`

/** Mirrors today's borrower behavior verbatim but routes through broker-specific
 *  endpoints and copy. Step 5 swaps the borrower credit/payment authorization
 *  for the broker's own certification; the borrower completes credit auth +
 *  payment later at /authorize/<token>. */
export const BROKER_VARIANT: VariantConfig = {
  kind: 'broker',
  fieldArrays: {
    borrowerFields: BORROWER_FIELDS,
    // Broker identity block renders first, then the shared primary-extra block.
    primaryExtraFields: [...BROKER_PRIMARY_EXTRA_FIELDS, ...PRIMARY_EXTRA_FIELDS],
    dealFields: DEAL_FIELDS,
    unitFields: UNIT_FIELDS,
    experienceFields: EXPERIENCE_FIELDS,
    declarationFields: DECLARATION_FIELDS,
    hmdaFields: HMDA_FIELDS,
  },
  endpoints: {
    draftPost: '/api/broker/apply/draft',
    draftPatch: '/api/broker/apply/draft',
    submit: '/api/broker/apply/submit',
    testSubmit: '/api/broker/apply/test-submit',
    upload: '/api/apply/upload',
  },
  branding: {
    logoSrc: '/logo.png',
    titleText: 'Loan Application (Broker)',
  },
  copy: {
    saveAndFinishLaterToast: "Saved. Use the link in your earlier email to come back any time.",
    submitButtonLabel: 'Submit Application',
    finalStepHeading: 'Broker Certification',
    step5AttestationLabel: 'Broker Certification and Electronic Signature',
    step5AttestationBody: BROKER_ATTESTATION_BODY,
  },
  redirects: {
    afterSubmit: '/broker/apply/submitted',
  },
  features: {
    showTestMode: false,
    autosaveEnabled: true,
    createDraftOnLoad: false,
    prefillFromAuthenticatedUser: false,
    sendBorrowerToAuthorize: 'broker-forwards',
    duplicateAccountBehavior: 'warn',
  },
  storageKeys: {
    testMode: 'fe-broker-apply-test-mode',
    testData: 'fe-broker-apply-test-data',
    testOverrides: 'fe-broker-apply-test-overrides',
  },
}

/** Client-side variant lookup. Server components pass `variantKind` as a string
 *  prop (functions inside `VariantConfig` can't cross the server→client wire);
 *  the client wizard reads the config from here. */
export const VARIANTS_BY_KIND: Record<VariantKind, VariantConfig> = {
  borrower: BORROWER_VARIANT,
  broker: BROKER_VARIANT,
}
