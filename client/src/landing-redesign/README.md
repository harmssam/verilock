# Landing redesign (preview only)

Parallel visual redesign of the **Journey home / landing** surface.

**Shell:** DocuSeal-inspired **light** SaaS (sticky top nav, hero + visual, white cards).

## Brand decision (locked)

**Light shell stays a non-production preview.** It does **not** replace Journey (`client/src/experiment/`, navy task UI on :5176 / production).

Ship this register only after an **explicit** brand decision to leave deep-navy product tokens. Until then:

| Surface | Status |
|---------|--------|
| Journey Edition | Production UI (navy + mint) |
| Landing redesign | Preview / experiment only (`noindex`, not default build) |

See root `PRODUCT.md` → *Landing redesign preview*.

## Rules

- **Does not modify** production files under `client/src/experiment/` (except by import).
- **Feature parity** with the live landing: same paths, shell routes, trust copy, how-it-works, agreements strip, account/credits, footer. See root `PRODUCT.md`.
- **`/security`** - Security & integrity (product-true; no invented certs). Shared `SecurityPage`. Header on desktop; footer-only on narrow (with Blog on very small screens).
- **Journey keep-alive:** `DocumentJourney` stays mounted (hidden) when visiting pricing/blog/privacy/security, matching production.
- After you pick a path, the **existing** `DocumentJourney` continues the flow (original UI for connect → seal). Only the landing shell is redesigned.

## Run

```bash
# API (optional, for wallet / agreements / pricing)
npm run dev --prefix server

# Redesign preview
npm run dev:landing-redesign --prefix client
# → http://localhost:5178/
```

Production Journey stays on port **5176** (`npm run dev --prefix client`).

### Path image placement (dev only)

Designer chrome for pan/zoom of path stills. **Hidden by default.**

```text
http://localhost:5178/?place=1
```

Requires `import.meta.env.DEV` **and** `?place=1`. Copy placements into `pathMedia.ts` to lock defaults. Never shown in production builds.

## Files

| Path | Role |
|------|------|
| `landing-redesign.html` | Entry HTML |
| `vite.landing-redesign.config.ts` | Vite on :5178 |
| `src/landing-redesign/*` | Redesign app + styles |
| `public/landing-redesign/path-*.jpg` | Role stills behind path cards |

## Pricing restyle

`/pricing` still mounts production `PricePage` (same promo data from `sealPricing`).  
Visual only: CSS under `.lr-app` / `.lr-app--pricing` in `LandingRedesign.css`.

## Mark

UI uses production **`/verilock-mark.png`** (same as Journey). Gold redesign exports under `public/landing-redesign/verilock-mark-gold*` are unused archive assets.

## Path backgrounds

| File | Path |
|------|------|
| `path-create.jpg` | Create & seal (sealed document / wax seal) |
| `path-invite.jpg` | I was invited (folder handoff, portrait 3:4) |
| `path-verify.jpg` | Verify a PDF (magnifier + stamp) |

Images are decorative only (`alt=""`). Label strips stay near-solid white for contrast; stills keep color and crop focus.

## Logged-in chrome (parity)

Same as production Journey shell:

- Agreements nav when wallet connected
- Credits chip when balance is finite → Pricing (hides Pricing nav link)
- Account menu: address, copy, agreements, credits, disconnect
- Home agreements strip via `JourneyAgreements`

## Not production

`noindex`. Not packaged into `client/dist` by default build.
