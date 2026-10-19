/**
 * Where the wizard's finish button stands. `retry` means a claim went out but
 * something failed since — a rejection, or a reconnect attempt that did not
 * make it — so the button is live again. The claim may still be buffered in the
 * socket and land once it reconnects, so `retry` still counts as sent.
 */
export type ClaimStatus = 'idle' | 'saving' | 'retry';

/** Whether the server's room now holds the character this wizard sent. */
export function claimLanded(status: ClaimStatus, claimed: boolean): boolean {
  return status !== 'idle' && claimed;
}
