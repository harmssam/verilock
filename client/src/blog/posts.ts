import type { BlogPost } from './types'
import { post as blockchainPdfSignatureVerification } from './posts/blockchain-pdf-signature-verification'
import { post as clearerPricingForPermanentSeals } from './posts/clearer-pricing-for-permanent-seals'
import { post as howToSignPdfWithBlockchain } from './posts/how-to-sign-pdf-with-blockchain'
import { post as howToVerifySignedPdfWithoutWallet } from './posts/how-to-verify-signed-pdf-without-wallet'
import { post as isThisTheSameFile } from './posts/is-this-the-same-file'
import { post as journeyEditionIsLive } from './posts/journey-edition-is-live'
import { post as prepaidCreditsForSeals } from './posts/prepaid-credits-for-seals'
import { post as privateSignaturesPublicProof } from './posts/private-signatures-public-proof'
import { post as secureOnlinePdfSigningForAgreements } from './posts/secure-online-pdf-signing-for-agreements'
import { post as tamperProofPdfVerification } from './posts/tamper-proof-pdf-verification'
import { post as walletScopedAgreementsHistory } from './posts/wallet-scoped-agreements-history'

/** All published posts. Sorted newest first at module load. */
export const ALL_POSTS: BlogPost[] = [
  prepaidCreditsForSeals,
  clearerPricingForPermanentSeals,
  journeyEditionIsLive,
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

export function getPostBySlug(slug: string): BlogPost | null {
  return bySlug.get(slug) ?? null
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
