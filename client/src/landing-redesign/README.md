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
- **Feature parity** with the live landing: same paths, shell routes, trust copy, how-it-works, account/credits, footer. Agreements open via header/AccountMenu → `/agreements` (no quiet home strip). See root `PRODUCT.md`.
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

### Path stills

Crops for home path cards and track banners are locked in `pathMedia.ts` (`PATH_PLACEMENTS`).

## Files

| Path | Role |
|------|------|
| `landing-redesign.html` | Entry HTML |
| `vite.landing-redesign.config.ts` | Vite on :5178 |
| `src/landing-redesign/*` | Redesign app + styles |
| `public/landing-redesign/path-*.jpg` | Role stills behind path cards |
| `public/landing-redesign/hero.jpg` | Home hero: VeriLock mark + Nimiq hex network |

## Pricing restyle

`/pricing` still mounts production `PricePage` (same promo data from `sealPricing`).  
Visual only: CSS under `.lr-app` / `.lr-app--pricing` in `LandingRedesign.css`.

## Mark

UI uses production **`/verilock-mark.png`** (same as Journey). Gold redesign exports under `public/landing-redesign/verilock-mark-gold*` are unused archive assets.

## Hero + path backgrounds

| File | Use |
|------|-----|
| `hero.jpg` | Home hero visual (VeriLock lock mark + gold Nimiq hex network on mint light) |
| `path-create.jpg` | Create & seal path card / track |
| `path-invite.jpg` | I was invited path card / track |
| `path-verify.jpg` | Verify a PDF path card / track |

Images are decorative only (`alt=""`). Hero is brand-led; path stills keep role metaphors. Label strips stay near-solid white for contrast.

## Logged-in chrome (parity)

Same as production Journey shell:

- Agreements nav when wallet connected → full `/agreements` page
- Credits chip when balance is finite → Pricing (hides Pricing nav link)
- Account menu: address, copy, agreements, credits, disconnect

## Not production

`noindex`. Not packaged into `client/dist` by default build.
