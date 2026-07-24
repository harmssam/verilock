---
name: verilock-blog-imagine
description: >
  Generate VeriLock blog / marketing stills with Grok Imagine CLI, using the
  product light-SaaS art system. Use when creating or replacing blog covers,
  body figures under client/public/blog, homepage blog art, or when the user
  asks for /imagine blog art, VeriLock product photography, or cover images.
---

# VeriLock blog Imagine

## Always use CLI Imagine (not session image_gen)

Follow **user skill `grok-imagine-cli`**. On this machine, `image_gen` is unreliable for final art.

```bash
cd <repo>/client/public/blog && \
grok -p "/imagine <PROMPT>" \
  --always-approve \
  --output-format plain \
  --no-subagents
```

Repo root is typically `/Users/sharms/_github_repos/verilock` (adapt if the clone path differs).

## Style lock (paste into every prompt)

Use this block after the subject/composition:

```
Setting: quiet modern office desk or clean product surface, soft daylight from the side.
Style: restrained light-SaaS product photography, near-white #fafdfc with soft mint wash #f0fdfa, teal accents #0d9488 / #14b8a6 only, minimal props, large empty background, no text, no logos, no watermarks.
Light: soft and even, low contrast, no god rays, no neon glow, no particles, no deep navy fields, no amber neon.
Mood: calm B2B trust product, professional document workflow, not crypto, not sci-fi.
Looks like a premium SaaS marketing photo, not a 3D crypto illustration.
```

For **covers**, end with: `1280x720 PNG. 16:9 landscape.`

## Specificity rule

Every cover must encode **this post’s unique claim**. If the image could headline any SaaS blog, reject and re-prompt.

| Pass | Fail |
|------|------|
| Caption swap fails (only this post) | Generic desk + laptop |
| One distinctive prop or relationship | Random mint wallpaper |

## When NOT to use Imagine

| Need | Prefer |
|------|--------|
| Exact readable words/UI chrome on the image | HTML/CSS → headless Chrome screenshot |
| Labeled diagrams, fee numbers | Code / SVG |
| Real product screens | UI screenshot crop |

See `client/src/blog/README.md` for full art rules, voice, and promo CTA rules.

## Ship checklist

1. CLI generate into `client/public/blog/`.
2. Visual QA with `read_file` on the image.
3. Resize/export to **1280×720 JPEG** if the post uses `.jpg` covers.
4. Update post `coverImage` / figure `src` + `coverAlt` / captions.
5. Reader copy: **lock on the blockchain**, not seal-as-a-verb.
6. Commit only when the user wants it live.

## Example (validated workflow)

Three-folder privacy comparison (worked with CLI):

```bash
cd client/public/blog && grok -p "/imagine Three document folders side by side on a clean light desk. Left and center open with signed papers; right closed with a small teal lock (privacy-first). [STYLE LOCK BLOCK] No text. 1280x720 PNG. 16:9 landscape." \
  --always-approve --output-format plain --no-subagents
```

Output example: `client/public/blog/privacy-first-document-folders.png`
