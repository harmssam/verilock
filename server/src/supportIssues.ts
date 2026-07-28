/**
 * Canonical support issue categories (form dropdown + ticket organization).
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

const ISSUE_IDS = new Set<string>(SUPPORT_ISSUE_OPTIONS.map(o => o.id))

export function isSupportIssueId(value: string): value is SupportIssueId {
  return ISSUE_IDS.has(value)
}

export function supportIssueLabel(id: SupportIssueId | string): string {
  const found = SUPPORT_ISSUE_OPTIONS.find(o => o.id === id)
  return found?.label ?? id
}
