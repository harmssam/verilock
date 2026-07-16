# Landing redesign (preview only)

Parallel visual redesign of the **Journey home / landing** surface.

**Shell:** DocuSeal-inspired **light** SaaS (sticky top nav, hero + visual, white cards). Intentional **preview** register (not production navy) until an explicit brand ship decision. VeriLock three paths + journey flow unchanged. Tokens on `body[data-verilock-surface=landing-redesign]` also lighten Journey chrome for track steps.

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

## Files

| Path | Role |
|------|------|
| `landing-redesign.html` | Entry HTML |
| `vite.landing-redesign.config.ts` | Vite on :5178 |
| `src/landing-redesign/*` | Redesign app + styles |
| `public/landing-redesign/path-*.jpg` | Muted Imagine stills behind the three path rows |

## Pricing restyle

`/pricing` still mounts production `PricePage` (same promo data: 95% off from `sealPricing`).  
Visual only: CSS under `.lr-app` / `.lr-app--pricing` in `LandingRedesign.css` (warm surfaces, solid promo badge, no glass card).

## Mark

UI uses production **`/verilock-mark.png`** (same as Journey). Gold redesign exports under `public/landing-redesign/verilock-mark-gold*` are unused archive assets.

## Path backgrounds

| File | Path |
|------|------|
| `path-create.jpg` | Create & seal (sealed document / wax seal) |
| `path-invite.jpg` | I was invited (folder handoff, portrait 3:4) |
| `path-verify.jpg` | Verify a PDF (magnifier + stamp) |

Images are decorative only (`alt=""`). CSS desaturates and scrims them so labels stay primary.

## Not production

`noindex`. Not packaged into `client/dist` by default build.
