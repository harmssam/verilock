export type BlogTag = 'guide' | 'feature' | 'privacy' | 'verify' | 'pricing'

export type BlogBlock =
  | { type: 'p'; text: string }
  | { type: 'h2'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'note'; text: string }
  | { type: 'figure'; src: string; alt: string; caption?: string }

export interface BlogPost {
  slug: string
  title: string
  description: string
  /** ISO date YYYY-MM-DD; feature posts align with git ship days. */
  date: string
  tags: BlogTag[]
  /** Cover art for index cards and post hero (public path). */
  coverImage: string
  coverAlt: string
  body: BlogBlock[]
  relatedSlugs?: string[]
}
