import type { BlogPost } from '../types'

const cover = '/blog/untitled-post.jpg'

export const post: BlogPost = {
  slug: 'untitled-post',
  title: 'Untitled post',
  description:
    'Draft post. Replace this description before publishing.',
  date: '2026-07-19',
  tags: ['feature'],
  coverImage: cover,
  coverAlt:
    'Abstract teal key and phone on a mint-white surface, suggesting wallet-based identity without email or password',

  body: [
    {
      type: 'p',
      text: 'Draft body. Open the Copy tab and rewrite, or edit the source file under client/src/blog/posts/.',
    },
  ],
}
