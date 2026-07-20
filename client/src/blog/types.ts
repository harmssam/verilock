export type BlogTag = 'guide' | 'feature' | 'privacy' | 'verify' | 'pricing'

/** Body figure placement. Default is full width of the article column. */
export type BlogFigureLayout = 'full' | 'left' | 'right' | 'narrow'

export type BlogBlock =
  | { type: 'p'; text: string }
  | { type: 'h2'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'note'; text: string }
  /** Pull quote or highlighted claim. Use sparingly (0–2 per post). */
  | { type: 'quote'; text: string; cite?: string }
  | {
      type: 'figure'
      src: string
      alt: string
      caption?: string
      /** full (default) | left/right float beside following copy | narrow centered */
      layout?: BlogFigureLayout
    }

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
