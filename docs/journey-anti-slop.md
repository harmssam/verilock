# Journey anti-slop checklist (agents)

Load this **before any Journey UI / redesign work**, together with:

| Doc | Why |
|-----|-----|
| **`PRODUCT.md`** | Feature parity law, inventory, brand personality |
| **`AGENTS.md`** | Journey-only production UI rules |
| **`.github/skills/impeccable/`** | Craft / critique / audit commands (if used) |
| **This file** | Positive design system, negative bans, pre-ship self-check |

**Surface:** `client/src/experiment/` + tokens in `client/src/index.css` + shared panels Journey imports.  
**Not the surface:** legacy `App.tsx`, `client/src/archive/`, greenfield “SaaS landing” templates.

---

## 1. Workflow (do this order)

Do **not** jump to “make it pretty.” Use a critique loop:

```
intent → constraints → tokens/reference → one surface → visual review → reject/revise → systemize
```

1. **Intent** — Which path/stage/shell screen? (Create / Invited / Verify, or pricing/blog/agreements.)
2. **Constraints** — Feature parity: same routes, stages, dock controls, privacy model. See `PRODUCT.md`.
3. **Positive reference** — Reuse existing tokens and components (section 2). Do not invent a second palette.
4. **Negative reference** — Run the ban list (section 3) before coding decorative chrome.
5. **One surface** — Path cards, dock, or stage; not a whole redesign pass in one shot.
6. **Review** — Section 5 self-check. Prefer scoped passes (“spacing only”, “contrast only”).
7. **Ugly states** — Section 6 before calling it done.
8. **Systemize** — If a new pattern is good, encode it in tokens/CSS classes, not a one-off.

**Context rule:** short prompt → long visual output is almost always slop. Prefer: paste the relevant component CSS, token block, and the ban list into the task rather than “restyle the hero.”

---

## 2. Positive reference (what VeriLock already is)

### Personality

Calm. Technical. Trust-first. Task-oriented mini app, not a campaign landing.  
Design **serves the workflow** (path → rail → dock → document stage).

### Tokens (source of truth: `client/src/index.css`)

| Role | Tokens / values |
|------|-----------------|
| Fonts | Display: **Bricolage Grotesque**; body/UI: **Figtree** (`--font-display`, `--font-body`) |
| Surfaces | Deep navy: `--bg-deep` `#0d112e`, `--bg-mid` `#121a38`, translucent `--surface*` |
| Text | `--text` / `--text-muted` / `--text-dim` (blue-tinted neutrals, not pure gray) |
| Accents | **Mint** primary (`--mint`, `--mint-deep`); **sky** secondary; **coral** errors; **lime** success accents; **amber** warnings |
| Brand gradient | `--gradient-brand` (mint → sky → blue) — reserved for brand moments (e.g. wordmark), not every card |
| Radius | `--radius-sm/md/lg/pill` |
| Shadows | Soft depth + optional mint/blue glow; use sparingly |

### IA (do not invent a fourth path)

- Path picker: **Create & seal** · **I was invited** · **Verify a PDF**
- Creator rail: Connect → Fingerprint → Share → Sign → Seal → Verify
- Signer rail: Connect → Sign → Done
- Verifier: Verify only (wallet optional)
- Shell: home, pricing, privacy, agreements, blog, 404

### Patterns that already work

- **One primary action** in the action dock; secondary stays secondary
- **Document stage** metaphor (fingerprint / signatures / seal) — product, not decoration
- **Local-file honesty** — PDF never leaves device; UI must keep saying so
- Restrained accent: mint for primary CTAs and state, not rainbow soup
- Familiar controls: selects, checkboxes, drop zones, buttons

### When you need external taste

Prefer real shipped product patterns over AI galleries:

- Existing Journey screens and `ExperimentApp.css` (first)
- Shared panels Journey already uses (`ShareInviteCard`, seal pricing, signature pad)
- Real app onboarding patterns (e.g. Mobbin) only as **structure** inspiration, not as a new brand

Do **not** free-range “best SaaS landing 2026” prompts into Journey chrome.

---

## 3. Negative reference (ban list)

If a change would make someone say “AI made this SaaS site,” reject it.

### Absolute bans (do not introduce)

| Ban | Why |
|-----|-----|
| Purple / violet → blue **hero gradients** as default chrome | Generic AI SaaS tell; VeriLock is navy + mint, not purple |
| **Inter** / generic system-only “startup sans” as the design system | We already have Bricolage + Figtree |
| Sparkle ✨ / 🚀 / “AI-powered” decorative emoji in product chrome | Noise; not trust |
| Fake testimonials (“Sarah Chen, Founder…”) on product shell | Not our product model |
| Three identical icon + title + blurb **feature cards** as the home IA | Path picker is the home IA |
| Vague **“Get started”** as the only primary CTA | Must name Create / Invited / Verify (or a real next step) |
| Glassmorphism **everywhere** (blur stacks on every panel) | Mobile GPU flash; already constrained in CSS |
| Gradient **text** on body copy / every heading | Brand wordmark may use it; do not expand |
| Side-stripe accent borders (`border-left: 3px+` color bars) on cards | Saturated AI scaffold |
| Tiny uppercase tracked **eyebrow on every section** | AI grammar |
| Numbered `01 / 02 / 03` eyebrows on every section | Only when order is real product sequence |
| Crypto-neon “web3 PDF” gimmick, wax-seal god rays, hash confetti | Wrong positioning (see blog art rules) |
| Cream/sand/parchment full-app background “for warmth” | Wrong register; product is deep navy task UI |
| New font families without an explicit brand request | Token drift |
| Nested cards inside cards for decoration | Lazy hierarchy |

### Allowed only when already intentional (do not expand)

- Ambient body radial blurs / soft blobs (`index.css`) — environment, not new UI chrome
- Light `backdrop-filter` on specific header/nav chrome — keep rare; prefer solid fills on mobile
- Document-stage paper gradient (light card on dark app) — metaphor only
- `--gradient-brand` on brand wordmark / rare brand moments

### Copy bans (product + blog)

- Em dashes (`—`) in user-facing copy (blog hard rule; prefer product too)
- Legal overclaims (“court-admissible”, “legally binding”) unless counsel-approved
- Moon language / absolute security claims
- Site-name CTAs (“try verilock.online”) on the product site itself

---

## 4. Rejection criteria (write these before generating)

Before a visual pass, answer:

1. **What must stay recognizable** as VeriLock (navy, mint, path-first IA)?
2. **What would make this feel generic AI SaaS?** (list 3 tells to ban for this task)
3. **What is the one primary action** on this screen?
4. **Does this still pass feature parity** (`PRODUCT.md` checklist)?
5. **Would a co-signer on mobile trust this** in 10 seconds, or pause at weird chrome?

If you cannot answer (1)–(3), do not generate UI.

---

## 5. Pre-ship self-check (agent taste checklist)

Run before marking UI work done. Prefer scoped iterations if something fails.

### Identity

- [ ] Uses existing CSS variables; no one-off hex rainbow
- [ ] Display font only for titles / brand; body/UI is Figtree
- [ ] Accent color on primary actions and state, not decorative fills everywhere
- [ ] Still reads as **document integrity tool**, not crypto casino or purple SaaS

### Hierarchy & layout

- [ ] One clear primary CTA; secondary actions look secondary
- [ ] Path / stage / dock structure intact (no fourth path, no buried intents)
- [ ] Spacing has rhythm (not equal 16px soup and not random gaps)
- [ ] No identical three-card marketing grid replacing path picker
- [ ] Long copy and narrow viewports do not overflow

### Product trust

- [ ] “PDF stays on device” / local fingerprint remains obvious where relevant
- [ ] Fees / promos still come from `sealPricing` (no invented numbers)
- [ ] Error, loading, empty, and disabled states exist for new controls
- [ ] Focus rings and keyboard paths work for header, path cards, dock, login sheet

### Motion & polish

- [ ] Motion is state feedback (150–250ms), not page-load choreography
- [ ] `prefers-reduced-motion` respected for anything new
- [ ] No new animated blur stacks that flash on mobile Safari

### The slop test

- [ ] Someone could **not** immediately tag this as “default AI landing”
- [ ] Someone fluent in good tools would **not** pause at every control as “off”

---

## 6. Ugly states (must test)

AI is good at the ideal screenshot. Product design is the rest:

| State | Check |
|-------|--------|
| Empty | No PDF yet; no agreements; no credits |
| Loading | Connect, seal, credit mint, hash, network |
| Error | Wrong PDF, wallet reject, payment fail, mismatch |
| Long copy | Long names, long agreement titles, long error strings |
| Mobile | Path cards, dock, signature pad, login sheet, sticky chrome |
| Reduced motion | No required animation to understand state |
| Logged out vs logged in | Header, agreements strip, pricing chip |

---

## 7. Redesign / Impeccable routing

| Task | Load |
|------|------|
| Any visual restyle | `PRODUCT.md` feature parity → this file → edit `experiment/` only |
| Impeccable craft/shape/polish | Impeccable setup + **product** register + this file |
| Blog art / copy | `client/src/blog/README.md` (no em dashes; promo fee CTAs) |
| Landing preview only | `client/src/landing-redesign/` — does **not** replace Journey |

**Feature parity wins over aesthetics.** If a visual idea conflicts with inventory, drop the visual idea.

---

## 8. Minimal agent prompt block (copy into UI tasks)

```
You are editing VeriLock Journey Edition only (client/src/experiment/).

Positive system:
- Tokens: client/src/index.css (navy deep bg, mint accent, Bricolage + Figtree)
- IA: path picker → stage rail → action dock → document stage
- Personality: calm, technical, trust-first; task UI not campaign landing
- PRODUCT.md feature parity is mandatory

Negative bans:
- No purple SaaS gradients, Inter-as-brand, sparkle/emoji chrome, fake testimonials
- No three-card generic feature grids, vague "Get started", glass everywhere
- No crypto-neon / wax-seal gimmick; no cream-paper full-app theme
- No new fonts or nested decorative cards

Workflow:
- intent → constraints → tokens → one surface → review checklist → ugly states
- One primary dock action; PDF-local honesty preserved
- Scope changes (e.g. spacing only) when iterating

Done only when docs/journey-anti-slop.md section 5 + PRODUCT.md parity checklist pass.
```

---

## Related

- Product inventory & parity: [`PRODUCT.md`](../PRODUCT.md)
- Journey contributor rules: [`AGENTS.md`](../AGENTS.md)
- Experiment notes: [`client/src/experiment/README.md`](../client/src/experiment/README.md)
- Blog voice: [`client/src/blog/README.md`](../client/src/blog/README.md)
