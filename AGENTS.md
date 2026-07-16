# VeriLock — agent / contributor instructions

## Production UI is one SPA only

**Default and only production frontend** is the light shell + journey product flow.

| Role | Path / command | Notes |
|------|----------------|-------|
| **PRIMARY shell** | `client/src/App.tsx` + `App.css` | Light landing, header, shell routes |
| **PRIMARY home** | `client/src/landing/` | Path cards, how-it-works, path stills |
| **PRIMARY product flow** | `client/src/journey/` | DocumentJourney, dock, seal, account, blog UI |
| **PRIMARY entry** | `client/src/main.tsx` → `App` | Mounted via `client/index.html` |
| **PRIMARY Vite config** | `client/vite.config.ts` | Default `npm run dev` / `npm run build` |
| **PRIMARY production URL** | `https://verilock.online` | Packaged into `client/dist` as root SPA |
| **Shared libraries** | `client/src/*.ts(x)` except archive | `nimiq.ts`, `api.ts`, seal helpers, pricing, etc. |
| **ARCHIVE (read-only)** | `client/src/archive/` | Pre-journey SPA, navy shell snapshot, orphans — do not extend |

### Commands (always prefer these)

```bash
npm run dev                 # server + client (:5176)
npm run dev --prefix client # client only
npm run build --prefix client
npm run test:service-b --prefix client
```

**Do not** look for parallel product UIs:

```bash
npm run dev:legacy          # removed
npm run dev:landing-redesign  # removed (promoted to production)
vite --config vite.journey.config.ts  # removed
vite --config vite.experiment.config.ts  # removed
```

### When implementing UI features

1. **Shell / home** → `client/src/App.tsx`, `client/src/landing/`, `client/src/App.css`.
2. **Path stages / dock / wallet** → `client/src/journey/` (`DocumentJourney.tsx`, etc.).
3. **Reuse** shared modules under `client/src/` — do not reimplement seal, wallet, or pricing.
4. **Never** treat `client/src/archive/` as the active product.
5. Journey **flow / information architecture** (path picker → stage rail → action dock → document stage) stays unless the user asks to redesign it.
6. Server APIs live under `server/` — shared; API changes must not assume a second client.

### How to tell you are on production

- Entry: `client/src/main.tsx` → `App`
- Product modules under `client/src/journey/`
- Home under `client/src/landing/`
- Dev URL: port **5176** (or next free), `index.html`
- Build: `package-service-b.mjs` / `vite.config.ts` → `client/dist`

### Shared vs archive-only

Safe shared edits (production may depend on these):

- `client/src/nimiq.ts`, `api.ts`, `session.ts`, hub redirect helpers
- `NimiqPayOpenPanel.tsx`, seal pricing, PDF hash, ShareInviteCard
- `PricePage`, `SecurityPage`, blog posts

Archive-only (do not invest product work without an explicit request):

- Anything under `client/src/archive/`

### Email / features

- Optional ready-to-seal email is gated by client `FEATURES.emailNotifyUi` and server Resend flags.

### Blog

- Journey blog: `client/src/blog/` + `BlogPage` under `/blog`.
- Author rules (no site-name CTAs, no em dashes, promo seal fee CTAs): **`client/src/blog/README.md`**.

### If the user says “the app” / “production” / “VeriLock UI”

Interpret as **`client/src/App.tsx` + `client/src/journey/` + `client/src/landing/`**, never archive snapshots.

### Redesign / Impeccable / visual overhaul

**Feature parity is mandatory.** Any redesign is a restyle of the production SPA only: same routes, paths, stages, docks, shell screens, and capabilities. Do not add or remove product features unless the user explicitly asks.

- Full inventory + acceptance checklist: **`PRODUCT.md`** (section *Feature parity law*)
- **Anti-slop design checklist:** **`docs/journey-anti-slop.md`**
  - Production chrome: light shell tokens; dock may still use navy task styles until a full dock restyle
  - Negative bans: purple SaaS gradients, glass-everywhere, generic feature cards, fake testimonials, crypto-neon gimmick
  - Pre-ship self-check + ugly-state tests + copy-paste agent prompt block
- Impeccable skills (if installed): `.github/skills/impeccable/` — always load `PRODUCT.md` first, then `docs/journey-anti-slop.md`

Follow these instructions exactly. When working in subdirectories not listed above, check for additional project instruction files (AGENTS.md, Claude.md, etc.).
