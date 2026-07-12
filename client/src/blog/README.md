# VeriLock blog - author notes

Journey SPA blog under `/blog`. Content lives in `client/src/blog/posts/`. UI in `client/src/experiment/BlogPage.tsx`. Production deep links need `/blog` in `server/src/static.ts` (`isKnownAppPath`).

## Voice

- Calm, technical, trust-focused, product-led
- Short sentences; privacy and permanence as design facts, not hype
- Prefer: sign, seal, fingerprint, permanent record, stays on your device, verify
- Avoid: legal overclaims (legally binding / court-admissible unless counsel-approved), moon language, absolute security claims

## Hard rules

1. **No em dashes** (`—` / U+2014). Use commas, periods, or hyphens.
2. **You are already on verilock.online.** Do not write "try it on verilock.online", "open verilock.online", or similar site-name CTAs. Readers are already on the product site.
3. **End-of-post CTA:** advertise the **current seal promo / fee**, not a generic "try the product" line. Soft internal paths only (Pricing, Verify, Agreements, home create flow) if you need a next step.
4. **Do not invent fees.** Read live numbers from `client/src/shared/sealPricing.ts` (and Pricing UI). As of July 2026: list **1000 NIM**, July promo **95% off → 50 NIM**, **promo ends August 1** (`isJulyPromoActive`: calendar month === July).
5. Feature post **dates** should match git ship days when advertising product work.
6. After adding a post: register in `posts.ts`, add cover under `client/public/blog/`, add URL to `client/public/sitemap.xml`.

## Current promo CTA (July 2026)

Use copy like:

- "Through the end of July, a permanent Nimiq seal is 50 NIM (95% off the 1000 NIM list price). Promo ends August 1."
- "Ready to lock a fingerprint? Seals are 50 NIM through July."

Article footer button should point at **Pricing** (or home create), with promo-aware label, not "Try it on verilock.online."

When the July promo ends, update this section and post closers so they do not promise 50 NIM.

## Post shape

```ts
{
  slug, title, description, date: 'YYYY-MM-DD',
  tags: ['guide' | 'feature' | 'privacy' | 'verify' | 'pricing'],
  coverImage: '/blog/<slug>.jpg',
  coverAlt: string,
  body: BlogBlock[], // p | h2 | ul | note | figure
  relatedSlugs?: string[],
}
```

Keep bodies light: short paragraphs, one figure for the main concept, lists where they help. No wall-of-text closers.

## Layout

Index is newsroom-style (featured + spotlight cards + compact archive). Shell is wide on desktop for blog/pricing/privacy/agreements; Journey create/sign stays compact.
