import type { BlogPost } from './types'
import { post as blockchainPdfSignatureVerification } from './posts/blockchain-pdf-signature-verification'
import { post as howToSignPdfWithBlockchain } from './posts/how-to-sign-pdf-with-blockchain'
import { post as howToVerifySignedPdfWithoutWallet } from './posts/how-to-verify-signed-pdf-without-wallet'
import { post as howVerilockWorks } from './posts/how-verilock-works'
import { post as isThisTheSameFile } from './posts/is-this-the-same-file'
import { post as prepaidCreditsForSeals } from './posts/prepaid-credits-for-seals'
import { post as privateSignaturesPublicProof } from './posts/private-signatures-public-proof'
import { post as secureOnlinePdfSigningForAgreements } from './posts/secure-online-pdf-signing-for-agreements'
import { post as tamperProofPdfVerification } from './posts/tamper-proof-pdf-verification'
import { post as walletScopedAgreementsHistory } from './posts/wallet-scoped-agreements-history'
import { post as whatIsVerilock } from './posts/what-is-verilock'

import { post as noEmailNoPasswordNimiqAccounts } from './posts/no-email-no-password-nimiq-accounts'
/** Retired slugs → canonical slug (merged or renamed posts). */
export const BLOG_SLUG_REDIRECTS: Record<string, string> = {
  'clearer-pricing-for-permanent-seals': 'prepaid-credits-for-seals',
}

/** All published posts. Sorted newest first at module load. */
export const ALL_POSTS: BlogPost[] = [
  noEmailNoPasswordNimiqAccounts,
  whatIsVerilock,
  howVerilockWorks,
  prepaidCreditsForSeals,
  walletScopedAgreementsHistory,
  privateSignaturesPublicProof,
  howToVerifySignedPdfWithoutWallet,
  tamperProofPdfVerification,
  howToSignPdfWithBlockchain,
  blockchainPdfSignatureVerification,
  secureOnlinePdfSigningForAgreements,
  isThisTheSameFile,
].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug)))

const bySlug = new Map(ALL_POSTS.map(p => [p.slug, p]))

export function getAllPosts(): BlogPost[] {
  return ALL_POSTS
}

export function resolveBlogSlug(slug: string): string {
  return BLOG_SLUG_REDIRECTS[slug] ?? slug
}

export function getPostBySlug(slug: string): BlogPost | null {
  return bySlug.get(resolveBlogSlug(slug)) ?? null
}

export function blogSlugFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/blog\/([^/]+)\/?$/)
  return m?.[1] ?? null
}

export function isBlogIndexPath(pathname: string): boolean {
  return /^\/blog\/?$/.test(pathname)
}

export function formatBlogDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) return isoDate
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
