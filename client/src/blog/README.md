# VeriLock blog - author notes

Journey SPA blog under `/blog`. Content lives in `client/src/blog/posts/`. UI in `client/src/experiment/BlogPage.tsx`. Production deep links need `/blog` in `server/src/static.ts` (`isKnownAppPath`).

## Voice

- Calm, technical, trust-focused, product-led
- Short sentences; privacy and permanence as design facts, not hype
- Prefer: sign, seal, fingerprint, permanent record, stays on your device, verify
- Avoid: legal overclaims (legally binding / court-admissible unless counsel-approved), moon language, absolute security claims
- **No internal codenames in reader copy.** Do not write "Journey", "Journey Edition", or "Journey home". Say "home screen", "Create & seal", "I was invited", "Verify a PDF", or "the app".

## Hard rules

1. **No em dashes** (`—` / U+2014). Use commas, periods, or hyphens.
2. **You are already on verilock.online.** Do not write "try it on verilock.online", "open verilock.online", or similar site-name CTAs. Readers are already on the product site.
3. **End-of-post CTA:** advertise the **current seal promo / fee**, not a generic "try the product" line. Soft internal paths only (Pricing, Verify, Agreements, home create flow) if you need a next step.
4. **Do not invent fees.** Read live numbers from `client/src/shared/sealPricing.ts` (and Pricing UI). As of July 2026: list **1000 NIM**, July promo **95% off → 50 NIM**, **promo ends August 1** (`isJulyPromoActive`: calendar month === July).
5. Feature post **dates** should match git ship days when advertising product work.
6. After adding a post: register in `posts.ts`, add cover (and any body images) under `client/public/blog/`, add URL to `client/public/sitemap.xml`.

## Length tiers

| Type | Body words | When |
|------|------------|------|
| **Feature / ship note** | ~60–100 | Product updates. Stay short. |
| **Short guide** | ~120–250 | One sharp how-to or concept. |
| **Medium guide** | ~400–700 | Default for SEO and canonical explainers. Multi-part thesis, definitions, or full loop. |

**Default new SEO content is a medium guide.** Do not inflate feature notes into medium posts.

Rough mix over time: about half medium guides, a quarter short guides, a quarter feature notes. Prefer medium posts for featured / spotlight when both are fresh.

Shape for medium guides:

- Hook in plain language
- 3–6 short H2 sections
- 1–2 lists
- 1 note for limits or non-claims
- Cover plus **2–3 body figures** (see Images)
- Promo closer + `relatedSlugs` into the pillar cluster

No wall-of-text closers. No long-form SEO pillars (1k+ words) unless explicitly planned.

## Images

| Asset | Job |
|-------|-----|
| **Cover** (`coverImage`) | Index card, featured, social. Unique per post. Business-editorial mood. |
| **Body figures** | Teach one idea. Prefer **real UI crops** or **code-built diagrams**; use generative art sparingly. |

### Positioning

VeriLock blog art should look like a **B2B trust / document workflow** product (contracts, remote teams, privacy, permanence), not a crypto or "web3 PDF" niche.

Readers should think: professional agreement tooling. Not: blockchain hobby, neon hash tokens, wax seals with god rays.

### How many images

Fewer, better. AI-ish overload is worse than one strong cover.

| Post type | Images |
|-----------|--------|
| Feature note | Cover only (optional 1 UI crop) |
| Short guide | Cover + **0–1** body figure |
| Medium guide | Cover + **1–2** body figures max |

Do not generate 3 decorative concept shots per post. If the body figure is only vibes, skip it or use a diagram.

### Choose the medium (in this order)

1. **Journey UI screenshot / crop** — best for product-true posts (verify match, path picker, seal step). Real pixels beat AI chrome.
2. **Code-built diagram** (SVG or HTML → export) — best for labeled flows, compare tables, "what lives where." Exact text stays readable. Prefer this over generative diagrams.
3. **Generative editorial still** — only for covers and rare scenario moments where photography-like restraint works. One subject, quiet light, no magic.

Never use generative art for: fee numbers, step labels, product logos as text, or multi-panel labeled explainer charts.

### Style lock (generative only)

**Target look:** Quiet editorial still-life or restrained corporate photography. Soft daylight or soft studio light. Muted navy / charcoal / warm gray / off-white paper. Small mint accent allowed only as a thin highlight (product tint), not a neon fog.

**Composition:** One clear subject. Large negative space. Centered or rule-of-thirds. 16:9 covers, 4:3 or 1:1 body if needed. Feels like Stripe / Linear / Notion marketing, not Midjourney "crypto dashboard."

**Specificity rule (critical):** Every cover must encode **this post's unique claim**. If you can swap the image onto a different post without the picture feeling wrong, it is too generic. Reject "laptop + stack of papers" unless the composition includes an irreplaceable prop or contrast that only that article needs.

| Test | Pass | Fail |
|------|------|------|
| Caption swap | Image only fits one post | Image could headline any SaaS blog |
| Props | One distinctive object or relationship | Generic desk kit only |
| Story | Readable in 2 seconds without title | Mood only, no idea |

**Subjects that fit business focus (make each unique):**

| Idea | Show this (specific) | Not this (generic or niche) |
|------|----------------------|-------------------------------|
| What is VeriLock / private product | Closed briefcase or folder **plus** a separate small stamped index card (file vs proof) | Lone laptop + papers |
| How it works / process | **Four distinct stations** in order (doc → pens → stamp → laptop check) | Random desk clutter |
| Multi-party sign | **One shared** agreement, two sets of hands, two pens mid-review | Hands near any paperwork |
| Verify without wallet | Laptop check **and** a closed physical wallet set aside / unused | Laptop alone with a check |
| Integrity / silent edit | Two near-identical pages, **one red-pen change** circled | Any two documents |
| Permanent record | Dated archive folder + rubber stamp mid-press on the cover sheet | Abstract seal glow |
| Pricing / credits | Clean paper receipt with a simple line item layout (no real fees invented in the image) | Coin stacks, glowing orbs |

### Banned (AI-ish + crypto-niche tells)

Do not put these in prompts or accept them in outputs:

- Blockchain chain links, hex grids, node networks, "web3" cityscapes
- Coins, tokens, hash `#` medallions, crypto wallet chrome as hero
- Oversized glowing fingerprints, DNA swirls, cyber seals
- Medieval wax seals with god rays / volumetric light shafts / particle dust
- Neon mint fog, holographic UI, floating HUD panels
- Generic "AI tech" gradients, bokeh sparkles, lens flare drama
- Readable fake legalese paragraphs (looks AI and wrong)
- Stock "hacker hoodie" or cyberpunk people

If an output shows any banned element, **do not ship**. Regenerate with a tighter prompt or switch to SVG / UI crop.

### Master prompt scaffold

Use this structure every time. Keep prompts short (3–5 sentences). Front-load the subject.

```text
[SUBJECT in one concrete sentence: real-world business object or scene.]

Setting: quiet office or soft studio desk, [daylight / soft gray studio].
Style: restrained editorial product photography, muted navy charcoal and off-white paper, minimal props, large empty background, no text, no logos, no watermarks.
Light: soft and even, low contrast, no god rays, no neon glow, no particles.
Mood: calm B2B trust product, professional document workflow, not crypto, not sci-fi.
```

**Optional one-line style suffix** (append when the model drifts toward fantasy):

```text
Looks like a premium SaaS marketing photo, not a 3D crypto illustration.
```

### Example prompts (copy and adapt)

**Cover — private agreement**

```text
A closed silver laptop on a dark wood desk with a single unsigned paper contract beside it, slightly out of focus plant in the far corner.

Setting: quiet modern office desk, soft daylight from the side.
Style: restrained editorial product photography, muted navy and warm gray, minimal props, large empty background, no text, no logos.
Light: soft and even, low contrast, no god rays, no neon, no particles.
Mood: calm B2B document privacy, professional, not crypto, not sci-fi.
```

**Cover — multi-party review**

```text
Two pairs of professional hands at a meeting table reviewing one shared printed agreement, pens nearby, no faces.

Setting: neutral conference table, soft daylight.
Style: restrained editorial photography, muted charcoal and off-white paper, minimal props, large empty space, no text, no logos.
Light: soft and even, no dramatic beams, no neon.
Mood: business collaboration and trust, not technology fantasy.
```

**Body — silent edit (integrity)**

```text
Two nearly identical printed contract pages side by side on a gray desk; the right page has one small circled number change in red pen.

Setting: soft studio desk top.
Style: clean editorial still life, muted palette, sharp focus on the pages, no text legible beyond a simple number, no logos.
Light: even softbox light, no glow effects.
Mood: careful business review, not cybersecurity poster art.
```

**Body — verify without wallet**

```text
An open laptop on a clean desk showing a blurred document in a generic browser window with a simple green check on a white dialog, no readable words.

Setting: bright minimal home office.
Style: product-adjacent editorial photo, muted tones, no brand logos, no crypto icons.
Light: natural window light, soft, no neon HUD.
Mood: ordinary professional verification, accessible and calm.
```

### Consistency workflow

1. Generate **one** approved cover that matches this system (or pick a hero still).
2. For variants, prefer `image_edit` on that base ("same lighting and palette, change only the desk object to …") instead of fresh random `image_gen`.
3. Reject anything that looks like a different brand universe.
4. Prefer reusing a small library of approved stills across posts over inventing a new universe each time.

### Diagrams and UI (preferred body art)

- **SVG / HTML diagram:** four-step flow, local vs public, integrity vs identity. Exact labels. Match blog CSS colors (`#0d112e`, mint `#5eead4` as thin accent only).
- **UI crop:** export from Journey at 2x, crop tight, no desktop clutter. Alt text describes the state ("Verify result: fingerprint match").

### Captions and alt

- Captions teach in plain business language ("A small change after signing means a different file").
- Avoid jargon in captions when the image is non-technical.
- Alt describes the scene or claim, not "abstract illustration of…"

### File layout

`client/public/blog/<slug>.jpg` cover; `/blog/<slug>-<role>.jpg` or `.svg` for body. Keep files reasonably small (aim under ~300KB when practical).

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
  body: BlogBlock[], // p | h2 | ul | note | quote | figure
  relatedSlugs?: string[],
}
```

### Body blocks (editorial layout)

| Block | Use |
|-------|-----|
| `p` / `h2` / `ul` | Default prose |
| `note` | Limits / non-claims (aside callout) |
| `quote` | Pull quote. Optional `cite`. 0–2 per post. |
| `figure` | Image. Optional `layout`: **`full`** (default, column width), **`left`** / **`right`** (float beside following paragraphs on desktop), **`narrow`** (centered inset, 4:3) |

Do not stack every figure as full width. Prefer one full process image, then a side figure next to the claim it illustrates. Quotes should restate a product fact already in the post, not marketing slogans.

## Pillar posts (canonical)

Link related guides into these when relevant:

- `what-is-verilock` — product definition and limits
- `how-verilock-works` — fingerprint → sign → seal → verify

## Layout

Index is newsroom-style (featured + spotlight cards + compact archive). Shell is wide on desktop for blog/pricing/privacy/agreements; Journey create/sign stays compact. Featured should prefer a medium guide when one is newest.

## Blog Studio (local)

Local UI at `/blog-studio` with two tabs:

| Tab | What it does |
|-----|----------------|
| **Images** | One **Image prompt** box: type your own text, or use **Write image prompt** / **Compare models** to draft from article copy. Then **Generate with Grok Imagine** runs local headless Grok (CLI OAuth) to write `client/public/blog/`. Handoff copy remains a fallback. |
| **Copy** | Loads live post prose from `client/src/blog/posts/`. Instruct the selected LLM to rewrite; preview; **Apply** writes title, description, and body back to the TypeScript source. |

| | |
|--|--|
| URL | `http://127.0.0.1:3002/blog-studio` (API server, not Vite) |
| Enable | Non-production only |
| Key | `OPENCODE_API_KEY` in `server/.env` (prompt drafting) |
| Grok Imagine | Local `grok` CLI + `grok login` (OAuth in `~/.grok/auth.json`). Optional `GROK_BIN`, `GROK_IMAGE_TIMEOUT_MS` (default 5m), `GROK_IMAGE_MAX_TURNS` |
| Models | Four checkboxes (all on by default): `qwen3.5-plus` / `qwen3.6-plus` on **Zen**; **`qwen3.7-plus` / `qwen3.7-max` on Go**. No primary dropdown. |
| Copy rewrite | **Rewrite copy** runs every checked model; pick a card to apply; failed cards **Retry this model** |
| Concurrency | Max **3** in-flight OpenCode HTTP calls process-wide (`OPENCODE_MAX_CONCURRENT`, hard-capped at 3). **One** Grok Imagine job at a time. |
| Abort | **Abort** cancels the active image or copy request (client + server; kills headless `grok` for Imagine) |
| Image drafts | `server/data/blog-studio-drafts/*.json` + `*.handoff.md` (+ `*.grok-run.log` after Imagine) |
| Copy apply | Overwrites the post `.ts` file (git to undo) |

### Image flow

1. `npm run dev` (server on :3002)
2. Ensure Grok CLI is installed and signed in: `grok login` (xAI OAuth — not the X developer API)
3. Open `/blog-studio`, pick post + asset
4. Type your own text in **Image prompt**, or **Write image prompt** (from article copy) / **Compare models** → **Use this prompt** (editable after)
5. **Generate with Grok Imagine** — uses the current prompt box text; server starts a **background** headless `grok` job (UI polls status; disconnect no longer kills the job). Imagine writes/overwrites the target under `client/public/blog/`, preview refreshes
6. Fallback: **Copy handoff** → paste into Grok Build chat if CLI is unavailable
7. Commit + push when you want production updated

### Copy flow

1. Same studio URL, pick a post, open the **Copy** tab
2. Read the live plain-text view of title, description, and body
3. Enter edit instructions → **Rewrite with Qwen**
4. Review the proposal (figures keep the same `src` paths)
5. **Apply rewrite to post file** when satisfied
6. Reload Journey `/blog` to preview; commit when ready

Studio is localhost-only unless `BLOG_STUDIO_TOKEN` is set.
