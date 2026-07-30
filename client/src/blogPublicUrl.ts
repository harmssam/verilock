/**
 * Public blog lives on blog.verilock.online (content-studio).
 * Product SPA links out; /blog on this host 301s as a fallback.
 */
export const BLOG_PUBLIC_ORIGIN =
  (typeof import.meta !== 'undefined' &&
    (import.meta as { env?: { VITE_BLOG_PUBLIC_ORIGIN?: string } }).env
      ?.VITE_BLOG_PUBLIC_ORIGIN?.trim().replace(/\/+$/, '')) ||
  'https://blog.verilock.online'

export function blogIndexUrl(): string {
  return `${BLOG_PUBLIC_ORIGIN}/`
}

export function blogPostUrl(slug: string): string {
  const s = slug.replace(/^\/+|\/+$/g, '')
  return `${BLOG_PUBLIC_ORIGIN}/${encodeURIComponent(s)}`
}

/** Product-host path `/blog/:slug` → slug, or null for index `/blog`. */
export function blogSlugFromProductPath(pathname: string): string | null {
  const m = pathname.match(/^\/blog\/([^/]+)\/?$/)
  return m?.[1] ?? null
}

export function isProductBlogPath(pathname: string): boolean {
  return /^\/blog(?:\/[^/]+)?\/?$/.test(pathname)
}

/** Map in-repo cover paths (/blog/foo.jpg) to public blog media URLs. */
export function blogMediaUrl(path: string): string {
  if (!path) return path
  if (/^https?:\/\//i.test(path)) return path
  if (path.startsWith('/blog/')) {
    return `${BLOG_PUBLIC_ORIGIN}/media/${path.slice('/blog/'.length)}`
  }
  if (path.startsWith('/media/')) {
    return `${BLOG_PUBLIC_ORIGIN}${path}`
  }
  return path
}

export function formatBlogDate(isoDate: string): string {
  const d = new Date(isoDate + (isoDate.length === 10 ? 'T12:00:00Z' : ''))
  if (Number.isNaN(d.getTime())) return isoDate
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export interface PublicBlogTeaserPost {
  slug: string
  title: string
  description: string
  date: string
  coverImage: string
  tags?: string[]
}

/**
 * Fetch published posts for homepage teaser.
 * Never throws — returns [] on failure so the home page always renders.
 */
export async function fetchPublicBlogTeaser(limit = 3): Promise<PublicBlogTeaserPost[]> {
  const url = `${BLOG_PUBLIC_ORIGIN}/api/blog/public/posts`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6_000)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return []
    const data = (await res.json()) as { posts?: PublicBlogTeaserPost[] }
    const posts = Array.isArray(data.posts) ? data.posts : []
    return posts.slice(0, Math.max(0, limit)).map(p => ({
      slug: p.slug,
      title: p.title,
      description: p.description || '',
      date: p.date || '',
      coverImage: blogMediaUrl(p.coverImage || ''),
      tags: p.tags,
    }))
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}
