export const SITE_NAME = 'VeriLock'
export const SITE_TAGLINE = 'Sign together. Prove forever.'
export const DEFAULT_ORIGIN = 'https://verilock.online'
export const DEFAULT_OG_IMAGE = '/verilock-mark.png'

export interface PageMeta {
  title: string
  description: string
  path?: string
  noindex?: boolean
}

const TITLE_SUFFIX = ` · ${SITE_NAME}`

export const PAGE_META = {
  home: {
    title: `${SITE_NAME} — Sign PDFs & Seal Document Hashes on Nimiq`,
    description:
      'Sign PDF agreements together and permanently anchor document fingerprints on the Nimiq blockchain. Your PDF never leaves your device — verify integrity anytime without a wallet.',
    path: '/',
  },
  pricing: {
    title: `Pricing${TITLE_SUFFIX}`,
    description:
      'One flat Nimiq seal fee locks your signed PDF fingerprint on-chain forever. Your document stays on your device — only its SHA-256 hash is recorded.',
    path: '/pricing',
  },
  privacy: {
    title: `Privacy Policy${TITLE_SUFFIX}`,
    description:
      'How VeriLock handles your data: PDFs stay on your device, only document fingerprints and signing metadata are stored, and sealed hashes remain public on Nimiq.',
    path: '/privacy',
  },
  security: {
    title: `Security & Integrity${TITLE_SUFFIX}`,
    description:
      'How VeriLock protects PDFs: local SHA-256 fingerprinting, wallet identity, on-chain hash seals on Nimiq, and verification without uploading your file. No invented certifications.',
    path: '/security',
  },
  blog: {
    title: `Blog${TITLE_SUFFIX}`,
    description:
      'Medium guides on what VeriLock is, how fingerprinting and Nimiq seals work, private PDF signing, wallet-optional verification, and product updates.',
    path: '/blog',
  },
  verify: {
    title: `Verify a Document${TITLE_SUFFIX}`,
    description:
      'Check whether a PDF matches a sealed VeriLock agreement. Fingerprint your file locally in the browser — no wallet required.',
    path: '/',
  },
  agreements: {
    title: `My Agreements${TITLE_SUFFIX}`,
    description: 'View and manage your VeriLock agreements.',
    path: '/agreements',
    noindex: true,
  },
  create: {
    title: `New Agreement${TITLE_SUFFIX}`,
    description: 'Fingerprint a PDF and start a multi-party signing workflow on VeriLock.',
    path: '/',
    noindex: true,
  },
  document: {
    title: `Agreement${TITLE_SUFFIX}`,
    description: 'Review, sign, or seal a VeriLock agreement.',
    noindex: true,
    path: '/',
  },
  notFound: {
    title: `Page not found${TITLE_SUFFIX}`,
    description: 'This page does not exist on VeriLock.',
    noindex: true,
    path: '/',
  },
} satisfies Record<string, PageMeta>

function siteOrigin(): string {
  if (typeof window !== 'undefined' && window.location.origin) {
    return window.location.origin
  }
  return DEFAULT_ORIGIN
}

function setMeta(attr: 'name' | 'property', key: string, content: string): void {
  if (typeof document === 'undefined') return
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.content = content
}

function setLink(rel: string, href: string): void {
  if (typeof document === 'undefined') return
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement('link')
    el.rel = rel
    document.head.appendChild(el)
  }
  el.href = href
}

export function applyPageMeta(meta: PageMeta): void {
  if (typeof document === 'undefined') return

  const origin = siteOrigin()
  const path = meta.path ?? '/'
  const url = `${origin}${path === '/' ? '/' : path}`
  const image = `${origin}${DEFAULT_OG_IMAGE}`

  document.title = meta.title

  setMeta('name', 'description', meta.description)
  setMeta('name', 'robots', meta.noindex ? 'noindex, nofollow' : 'index, follow')

  setMeta('property', 'og:type', 'website')
  setMeta('property', 'og:site_name', SITE_NAME)
  setMeta('property', 'og:title', meta.title)
  setMeta('property', 'og:description', meta.description)
  setMeta('property', 'og:url', url)
  setMeta('property', 'og:image', image)
  setMeta('property', 'og:locale', 'en_US')

  setMeta('name', 'twitter:card', 'summary_large_image')
  setMeta('name', 'twitter:title', meta.title)
  setMeta('name', 'twitter:description', meta.description)
  setMeta('name', 'twitter:image', image)

  setLink('canonical', url)
}

export function journeyPathMeta(
  pathname: string,
  search: string,
  options?: {
    document?: { title: string; slug: string } | null
    verifyMatchTitle?: string | null
    role?: 'creator' | 'signer' | 'verifier' | null
  },
): PageMeta {
  const docSlug = pathname.match(/^\/d\/([^/]+)/)?.[1] ?? null
  const vSlug = pathname.match(/^\/v\/([^/]+)/)?.[1] ?? null

  if (docSlug) {
    if (options?.document) {
      return {
        ...documentPageMeta(options.document.title, 'sign'),
        path: `/d/${options.document.slug}`,
      }
    }
    return { ...PAGE_META.document, path: `/d/${docSlug}` }
  }

  if (vSlug) {
    if (options?.verifyMatchTitle) {
      return {
        ...documentPageMeta(options.verifyMatchTitle, 'verify'),
        path: `/v/${vSlug}`,
      }
    }
    return { ...PAGE_META.verify, path: `/v/${vSlug}` }
  }

  if (new URLSearchParams(search).get('intent')) {
    return { ...PAGE_META.create }
  }

  if (options?.role === 'verifier') {
    return { ...PAGE_META.verify }
  }

  if (options?.role === 'creator' || options?.role === 'signer') {
    return { ...PAGE_META.create }
  }

  return { ...PAGE_META.home }
}

export function documentPageMeta(title: string, role: 'sign' | 'verify'): PageMeta {
  const verb = role === 'verify' ? 'Verify' : 'Sign'
  return {
    title: `${title} · ${verb} on ${SITE_NAME}`,
    description: `${verb} "${title}" on VeriLock. Fingerprint your PDF locally, collect Nimiq wallet signatures, and seal the document hash on-chain.`,
    path: undefined,
    noindex: true,
  }
}

export function blogPostMeta(post: { title: string; description: string; slug: string }): PageMeta {
  return {
    title: `${post.title}${TITLE_SUFFIX}`,
    description: post.description,
    path: `/blog/${post.slug}`,
  }
}