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
