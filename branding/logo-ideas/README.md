# VeriLock logo concepts

Five AI-generated directions for review. Palette matches the app: deep purple background, mint–lime–violet gradients.

| File | Concept |
|------|---------|
| `logo-01-lock-check.jpg` | Minimal padlock + checkmark — verification-first |
| `logo-02-shield-lock.jpg` | Shield + lock — trust and security |
| `logo-03-lock-chain.jpg` | Lock + chain link — on-chain anchoring |
| `logo-04-vl-monogram.jpg` | V+L lettermark — brandable app icon |
| `logo-05-document-seal.jpg` | Document + seal stamp — PDF signing |

**Interim site logo:** `logo-01` is copied to `client/public/verilock-logo.png` and `verilock-logo-96.png` until you pick a favorite.

### logo-03 lock-chain variations

Five variants plus the original are in `logo-03-variations/`. Each has a `.jpg` source and a **transparent PNG** (white outer margins removed).

| PNG | Style |
|-----|-------|
| `logo-03a-lock-chain.png` | Classic glossy lock + V + short chain |
| `logo-03b-lock-chain.png` | Longer three-link chain |
| `logo-03c-lock-chain.png` | Violet-heavy palette |
| `logo-03d-lock-chain.png` | Ultra-minimal flat strokes |
| `logo-03e-lock-chain.png` | Luminous mint glow (full-bleed purple) |

Re-run transparency conversion:

***REMOVED***
branding/scripts/.venv/bin/python branding/scripts/jpg-to-transparent-png.py branding/logo-ideas/logo-03-variations/*.jpg -o branding/logo-ideas/logo-03-variations
***REMOVED***

To swap after choosing: copy the winner into `client/public/` as `verilock-logo.png`, then resize to 96×96 for the favicon.