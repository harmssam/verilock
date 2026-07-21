import { useEffect } from 'react'
import {
  blogSlugFromPath,
  formatBlogDate,
  getAllPosts,
  getPostBySlug,
  resolveBlogSlug,
  type BlogBlock,
  type BlogPost,
  type BlogTag,
} from '../blog'
import './BlogPage.css'

interface BlogPageProps {
  path: string
  onOpenIndex: () => void
  onOpenPost: (slug: string) => void
  /** Prefer pricing so CTAs advertise lock fee / promo without leaving the site. */
  onPricing: () => void
}

const TAG_LABEL: Record<BlogTag, string> = {
  guide: 'Guide',
  feature: 'Update',
  privacy: 'Privacy',
  verify: 'Verify',
  pricing: 'Pricing',
}

function primaryTag(tags: BlogTag[]): BlogTag {
  return tags[0] ?? 'guide'
}

function BlogPostBody({ body }: { body: BlogBlock[] }) {
  return (
    <div className="blog-body">
      {body.map((block, i) => {
        if (block.type === 'h2') {
          return (
            <h3 key={i} className="blog-body-h2">
              {block.text}
            </h3>
          )
        }
        if (block.type === 'ul') {
          return (
            <ul key={i} className="blog-body-list muted">
              {block.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          )
        }
        if (block.type === 'note') {
          return (
            <p key={i} className="blog-body-note muted">
              {block.text}
            </p>
          )
        }
        if (block.type === 'quote') {
          return (
            <blockquote key={i} className="blog-body-quote">
              <p className="blog-body-quote-text">{block.text}</p>
              {block.cite ? (
                <cite className="blog-body-quote-cite muted">{block.cite}</cite>
              ) : null}
            </blockquote>
          )
        }
        if (block.type === 'figure') {
          const layout = block.layout ?? 'full'
          return (
            <figure
              key={i}
              className={`blog-figure blog-figure--${layout}`}
            >
              <img src={block.src} alt={block.alt} loading="lazy" decoding="async" />
              {block.caption ? (
                <figcaption className="blog-figure-caption">{block.caption}</figcaption>
              ) : null}
            </figure>
          )
        }
        return (
          <p key={i} className="blog-body-p muted">
            {block.text}
          </p>
        )
      })}
    </div>
  )
}

function CategoryLabel({ tags }: { tags: BlogTag[] }) {
  const tag = primaryTag(tags)
  return <span className={`blog-cat blog-cat--${tag}`}>{TAG_LABEL[tag]}</span>
}

function RelatedPosts({
  post,
  onOpenPost,
}: {
  post: BlogPost
  onOpenPost: (slug: string) => void
}) {
  const related = (post.relatedSlugs ?? [])
    .map(slug => getPostBySlug(slug))
    .filter((p): p is BlogPost => p != null)
  if (related.length === 0) return null
  return (
    <aside className="blog-related" aria-label="Related posts">
      <h3 className="blog-related-title">Related</h3>
      <ul className="blog-related-grid">
        {related.map(r => (
          <li key={r.slug}>
            <button type="button" className="blog-related-card" onClick={() => onOpenPost(r.slug)}>
              <img src={r.coverImage} alt="" loading="lazy" decoding="async" />
              <span className="blog-related-card-title">{r.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}

function BlogIndex({ onOpenPost }: { onOpenPost: (slug: string) => void }) {
  const posts = getAllPosts()
  const [featured, ...rest] = posts
  const spotlight = rest.slice(0, 3)
  const archive = rest.slice(3)

  return (
    <section className="blog-page blog-page--index" aria-labelledby="blog-index-title">
      <header className="blog-index-header">
        <h2 id="blog-index-title">Blog</h2>
        <p className="muted blog-lead">
          Guides on private signing and permanent proof, plus product updates.
        </p>
      </header>

      {featured ? (
        <button
          type="button"
          className="blog-featured"
          onClick={() => onOpenPost(featured.slug)}
        >
          <div className="blog-featured-media">
            <img
              src={featured.coverImage}
              alt={featured.coverAlt}
              loading="eager"
              decoding="async"
            />
          </div>
          <div className="blog-featured-copy">
            <div className="blog-meta-row">
              <CategoryLabel tags={featured.tags} />
              <time dateTime={featured.date}>{formatBlogDate(featured.date)}</time>
            </div>
            <span className="blog-featured-title">{featured.title}</span>
            <span className="blog-featured-desc muted">{featured.description}</span>
          </div>
        </button>
      ) : null}

      {spotlight.length > 0 ? (
        <ul className="blog-spotlight">
          {spotlight.map(post => (
            <li key={post.slug}>
              <button
                type="button"
                className="blog-spotlight-card"
                onClick={() => onOpenPost(post.slug)}
              >
                <div className="blog-spotlight-media">
                  <img src={post.coverImage} alt="" loading="lazy" decoding="async" />
                </div>
                <div className="blog-meta-row">
                  <CategoryLabel tags={post.tags} />
                  <time dateTime={post.date}>{formatBlogDate(post.date)}</time>
                </div>
                <span className="blog-spotlight-title">{post.title}</span>
                <span className="blog-spotlight-desc muted">{post.description}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {archive.length > 0 ? (
        <div className="blog-archive">
          <div className="blog-archive-head">
            <h3 className="blog-archive-title">All posts</h3>
            <div className="blog-archive-cols muted" aria-hidden>
              <span>Date</span>
              <span>Category</span>
              <span>Title</span>
            </div>
          </div>
          <ul className="blog-archive-list">
            {archive.map(post => (
              <li key={post.slug}>
                <button
                  type="button"
                  className="blog-archive-row"
                  onClick={() => onOpenPost(post.slug)}
                >
                  <time dateTime={post.date}>{formatBlogDate(post.date)}</time>
                  <CategoryLabel tags={post.tags} />
                  <span className="blog-archive-row-title">{post.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

function BlogPostView({
  post,
  onOpenIndex,
  onOpenPost,
  onPricing,
}: {
  post: BlogPost
  onOpenIndex: () => void
  onOpenPost: (slug: string) => void
  onPricing: () => void
}) {
  const bodyHasCoverFigure = post.body.some(
    b => b.type === 'figure' && b.src === post.coverImage,
  )

  return (
    <article className="blog-page blog-page--post" aria-labelledby="blog-post-title">
      <button type="button" className="blog-back" onClick={onOpenIndex}>
        ← All posts
      </button>
      <div className="blog-meta-row">
        <CategoryLabel tags={post.tags} />
        <time dateTime={post.date} className="blog-post-date">
          {formatBlogDate(post.date)}
        </time>
      </div>
      <h2 id="blog-post-title">{post.title}</h2>
      <p className="muted blog-lead blog-lead--post">{post.description}</p>
      {!bodyHasCoverFigure ? (
        <figure className="blog-figure blog-figure--hero">
          <img
            src={post.coverImage}
            alt={post.coverAlt}
            loading="eager"
            decoding="async"
          />
        </figure>
      ) : null}
      <BlogPostBody body={post.body} />
      <RelatedPosts post={post} onOpenPost={onOpenPost} />
      <div className="blog-cta">
        <p className="muted blog-cta-note">
          Through July, locking a fingerprint on the blockchain is 50 NIM (95% off list). Promo ends
          August 1.
        </p>
        <button type="button" className="btn btn-primary" onClick={onPricing}>
          See pricing
        </button>
      </div>
    </article>
  )
}

function BlogNotFound({
  path,
  onOpenIndex,
}: {
  path: string
  onOpenIndex: () => void
}) {
  return (
    <section className="blog-page card" aria-labelledby="blog-missing-title">
      <h2 id="blog-missing-title">Post not found</h2>
      <p className="muted blog-lead">That post does not exist or the link is out of date.</p>
      {path ? (
        <p className="muted blog-missing-path">
          <code className="mono">{path}</code>
        </p>
      ) : null}
      <button type="button" className="btn btn-primary" onClick={onOpenIndex}>
        Back to blog
      </button>
    </section>
  )
}

function BlogSlugRedirect({
  fromSlug,
  toSlug,
  onOpenPost,
}: {
  fromSlug: string
  toSlug: string
  onOpenPost: (slug: string) => void
}) {
  useEffect(() => {
    if (fromSlug !== toSlug) onOpenPost(toSlug)
  }, [fromSlug, toSlug, onOpenPost])
  return null
}

export function BlogPage({ path, onOpenIndex, onOpenPost, onPricing }: BlogPageProps) {
  // SPA navigation keeps scroll position; always open blog views at the top.
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [path])

  const slug = blogSlugFromPath(path)
  if (!slug) {
    return <BlogIndex onOpenPost={onOpenPost} />
  }
  const canonical = resolveBlogSlug(slug)
  const post = getPostBySlug(canonical)
  if (!post) {
    return <BlogNotFound path={path} onOpenIndex={onOpenIndex} />
  }
  if (slug !== post.slug) {
    return <BlogSlugRedirect fromSlug={slug} toSlug={post.slug} onOpenPost={onOpenPost} />
  }
  return (
    <BlogPostView
      post={post}
      onOpenIndex={onOpenIndex}
      onOpenPost={onOpenPost}
      onPricing={onPricing}
    />
  )
}
