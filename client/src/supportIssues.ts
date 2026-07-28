/**
 * Support issue categories (must match server/src/supportIssues.ts).
 */

export const SUPPORT_ISSUE_OPTIONS = [
  { id: 'wallet_connect', label: 'Nimiq wallet / connect' },
  { id: 'wallet_mismatch', label: 'Wallet does not match slot' },
  { id: 'free_vs_lock', label: 'Free sign vs permanent lock' },
  { id: 'lock_failed', label: 'Lock / seal failed' },
  { id: 'credits', label: 'Credits & payment' },
  { id: 'invite', label: 'Invite / share link' },
  { id: 'verify', label: 'Verify a sealed document' },
  { id: 'other', label: 'Other' },
] as const

export type SupportIssueId = (typeof SUPPORT_ISSUE_OPTIONS)[number]['id']
