import { sendApplicationNotifications as _sendBorrowerNotifications } from '@/lib/apply-notify'
import type { ApplicationData } from '@/lib/application-fields'
import type { MappedApplication } from '@/lib/application-mapper'

export interface NotifyArgs {
  loanId: string
  data: ApplicationData
  m: MappedApplication
  variant?: 'borrower' | 'broker'
  submittedByBrokerId?: string | null
}

/** Borrower-submitted notifications (today's behavior — PDF, borrower email,
 *  internal notice). Kept as a re-export so the call site contract is the same
 *  shape as the future broker/authorization-signed helpers. */
export async function sendBorrowerSubmittedNotifications(args: NotifyArgs) {
  await _sendBorrowerNotifications({ loanId: args.loanId, data: args.data, m: args.m })
}

/** Stub — fleshed out in PR 3. Broker confirmation + forwardable link + internal notice. */
export async function sendBrokerSubmittedNotifications(_args: NotifyArgs) {
  // Intentionally empty in PR 1; PR 3 implements the broker confirmation email.
}

/** Stub — fleshed out in PR 2/PR 3. Fired when the borrower completes /authorize. */
export async function sendAuthorizationSignedNotifications(_args: NotifyArgs) {
  // Intentionally empty in PR 1; later PRs send the final-authorized notifications.
}
