# VeriLock — product context (Impeccable / redesign)

## Register

**product** (primary). The live surface is a task-oriented mini app: create, invite, sign, seal, verify. Marketing-adjacent chrome (blog, pricing, taglines) exists, but design **serves the workflow**, not a campaign landing page.

When a redesign task is scoped only to blog/pricing marketing copy, that slice may use **brand** register rules **without** inventing new product capabilities.

## Platform

**web** (responsive mobile web + desktop browser; also embedded as a Nimiq Pay mini app).

## Users

| Priority | Who | Context |
|----------|-----|---------|
| Primary | People who need a permanent integrity proof of a PDF agreement | Remote parties, rental/contract/NDA flows, no shared document store |
| Secondary | Co-signers who received a PDF + invite link | Match file, sign with wallet, leave |
| Secondary | Anyone verifying a sealed PDF later | No account required |
| Tertiary | Blog / pricing visitors | Learn privacy model or buy seal credits |

## Purpose

Fingerprint a PDF **on-device**, optionally collect multi-party wallet signatures, then **anchor only the hash** on Nimiq so anyone can re-verify the same bytes later. The file never uploads.

## Positioning

**Wallet identity + local PDF fingerprint + on-chain hash lock** — multi-party agreements without uploading documents to VeriLock.

## Brand personality

Calm. Technical. Trust-first. No moon language, no legal overclaims.

## Anti-references

- Generic purple SaaS / glassmorphism “AI startup” landings
- Crypto-neon “web3 PDF” gimmick branding
- Feature bloat that hides the three paths (Create / Invited / Verify)
- Redesigns that invent new flows or drop existing ones (see **Feature parity law**)

**Agent checklist (positive tokens, ban list, pre-ship self-check, ugly states):** [`docs/journey-anti-slop.md`](docs/journey-anti-slop.md)

## Accessibility

- Prefer WCAG AA contrast on body and controls
- Respect `prefers-reduced-motion`
- Keep keyboard/focus paths for header, path cards, dock actions, login sheet

---

## Feature parity law (mandatory for any redesign)

**Any redesign of the webpage / Journey UI must match the current feature set one-to-one.**

| Allowed | Forbidden without an explicit user request |
|---------|-----------------------------------------------|
| Visual restyle (type, color, spacing, density, motion polish) | Adding screens, paths, steps, or product capabilities |
| Reordering layout **within** an existing surface | Removing a path, step, route, control, or gate |
| Clearer copy that preserves meaning | Changing business rules (fees, sign counts, privacy model) |
| Same components, better hierarchy | Merging Create/Invited/Verify into a different IA |
| Shared-module restyles that Journey already uses | Restoring archive shells as production |

### Hard rules

1. **Same routes, same deep links, same query flags** (see inventory).
2. **Same three path roles** and **same stage rails** for each role.
3. **Same action-dock steps and controls** (fields, toggles, CTAs, cancel, share, credits, signature pad).
4. **Same shell screens** (home journey, pricing, privacy, agreements, blog, 404).
5. **Same account/login/credits behaviors** (Hub vs Pay modes, balance chip → pricing, Stripe return).
6. **Same privacy model** in UI copy and structure: PDF stays local; chain stores hash only.
7. **Feature flags stay flags** (`FEATURES.emailNotifyUi`); do not hard-remove optional email when the flag exists.
8. **Information architecture** from `AGENTS.md` stays: path picker → stage rail → action dock → document stage, unless the user explicitly redesigns IA.

### Acceptance checklist (redesign done only if all true)

- [ ] Path picker still offers exactly: **Create & seal**, **I was invited**, **Verify a PDF**
- [ ] Creator stages still: Fingerprint → Sign → Share → Seal → Verify (wallet login is a gate, not a rail step)
- [ ] Signer stages still: Sign → Done (wallet login is a gate on submit, not a rail step)
- [ ] Verifier stages still: Verify only (wallet optional)
- [ ] Deep links `/d/:slug`, `/v/:slug`, `?intent=`, `?preferSeal=1` still work
- [ ] Shell routes `/`, `/pricing`, `/privacy`, `/agreements`, `/blog`, `/blog/:slug`, 404 still exist
- [ ] Header: brand home, Agreements (when logged in), Pricing (when no credits chip), Blog, AccountMenu
- [ ] Footer: tagline, Blog, Security, Privacy Policy
- [ ] How it works + privacy notes still present
- [ ] Document stage metaphor still present (fingerprint / signatures / seal feedback)
- [ ] Share invite (copy link, email package patterns) still present where creator can invite
- [ ] Seal payment paths still: NIM fee / credits / progress UI as today
- [ ] Signature pad + optional signature image still available on sign
- [ ] Agreements list (welcome strip + full page) still open docs and prefer-seal CTA
- [ ] No new primary CTA that invents a fourth path or skips an existing required gate

If a visual idea conflicts with a row above, **drop the visual idea**, not the feature.

---

## Feature inventory (source of truth: production SPA)

Production UI: `client/src/App.tsx` (light shell) · `client/src/landing/` (home) · `client/src/journey/` (DocumentJourney + dock) · styles `App.css` + `journey/Journey.css` + `index.css` tokens.

### Shell (`App`)

| Feature | Notes |
|---------|--------|
| Brand home control | Logo + wordmark + tagline → reset to `/` journey home |
| Nav: Agreements | Shown when wallet connected |
| Nav: Pricing | Shown when credits chip not already covering pricing |
| Nav: Blog | Index + posts |
| Nav: Security | Header on desktop; footer on narrow (with Blog on very small screens) |
| Account menu | Login sheet, address, copy, agreements, credits → pricing, disconnect |
| Credits balance chip | When credits enabled and logged in |
| Wallet status / error banner | Connect and payment errors |
| Back to home | On pricing / privacy / security / agreements / blog / 404 |
| Journey keep-alive | DocumentJourney stays mounted (hidden) when visiting other shell screens |
| Stripe checkout return | Mint/refresh credits after card purchase |
| Footer | Tagline + Blog + Security + Privacy Policy |
| Home path picker | Light landing (`LandingHome`) — not the navy welcome strip |

### Routes

| Path | Surface |
|------|---------|
| `/` | Journey home (path picker) |
| `/?intent=creator\|signer\|verifier` | Sticky path intent |
| `/d/:slug` | Open agreement in journey |
| `/d/:slug?preferSeal=1` | Jump toward seal when allowed |
| `/v/:slug` | Verify deep link |
| `/pricing` | Seal fee + buy credits (NIM / card) |
| `/privacy` | Privacy policy |
| `/security` | Security & integrity (product-true claims only) |
| `/agreements` | Full agreements list |
| `/blog`, `/blog/:slug` | Blog index / post |
| unknown | 404 page with home |

### Home / welcome

| Feature | Notes |
|---------|--------|
| Feature rotator | Privacy, fee/promo line, verify, co-sign, hash-on-Nimiq |
| Path: Create & seal | Role `creator` |
| Path: I was invited | Role `signer` |
| Path: Verify a PDF | Role `verifier` |
| How VeriLock works | Collapsible multi-beat story, role-aware |
| Privacy / trust copy | Expandable privacy framing |
| Journey agreements strip | When logged in: recent agreements, open, seal CTA, view all |

### Creator path stages

Wallet login (LoginSheet / Hub / Pay) is a **gate** when creating, signing, or sealing — not a numbered stage.

1. **Fingerprint** — PDF drop/browse, local SHA-256, agreement type (rental/contract/nda/other), rental landlord/tenant, full name, optional email notify (flag), optional title, **direct seal** checkbox, required signer count 1–4, optional co-signer names, optional notes (type-dependent), create CTA (prompts login if needed)
2. **Sign** — Creator signs first: signature progress, party list, cancel (creator), match PDF, signature pad / image, sign CTA
3. **Share** — After creator signed: party list, ShareInviteCard (copy link / email package), wait for co-signers, cancel until first signature (if still allowed)
4. **Seal** — Pricing display, credits panel / NIM pay / credit seal progress, lock on chain
5. **Verify** — Re-drop PDF to confirm match after seal / done

### Signer path stages

1. **Sign** — Drop PDF to lookup agreement **or** open `/d/:slug`; match fingerprint; login when ready to sign; name if needed; signature pad; sign
2. **Done** — Confirmation; seal is creator’s job

### Verifier path stages

1. **Verify** — Drop PDF, local hash, lookup matches, mismatch handling; **wallet optional** (skip login)

### Cross-cutting journey UI

| Feature | Component / area |
|---------|------------------|
| Stage rail progress | `StageRail` |
| Action dock (one action focus) | `DocumentJourney` dock |
| Document stage visual | `DocumentStage` |
| PDF drop zone | `PdfDropZone` / stage accepting |
| Start over | Reset to path picker |
| Role pill | Creating / signing / verifying as… |
| Per-step privacy note | Dock header |
| Signatures panel patterns | Party list, signed counts |
| Delete/cancel agreement | When `canDeleteDocument` allows |
| Credit seal progress | Non-blocking seal UX |
| Hub return path + intent restore | `hubReturnPath`, `journeyIntent` |

### Shared product modules Journey depends on (restyle OK; remove not OK)

- `NimiqPayOpenPanel` / Hub connect flows
- `ShareInviteCard` (+ email package when enabled)
- `SealPricingDisplay` / `sealPricing` (promo-aware fees)
- `PricePage` (credits NIM + Stripe)
- `SignaturesPanel` / signing helpers
- `VerifyMatchesPanel`
- Blog posts + `BlogPage` rules (`client/src/blog/README.md`)

### Explicitly out of redesign scope (do not reintroduce as primary)

- Archive UI under `client/src/archive/` (pre-journey SPA, navy shell snapshot)
- New email product redesign beyond existing `FEATURES.emailNotifyUi` gate

---

## Brand decision (production)

**Light DocuSeal-style shell is production** (`App` + `landing/`).

| Surface | Status |
|---------|--------|
| Light shell + home | Production (`npm run dev` / `npm run build` / verilock.online) |
| DocumentJourney dock / stage | Same product flow; may still use navy task CSS until a full dock restyle |
| Navy `ExperimentApp` shell | Archived under `client/src/archive/navy-shell-2026-07-16/` |

Agreements open via header / AccountMenu → `/agreements` (no quiet home strip).

## Design principles (parity-safe)

1. **Task first** — Path → rail → dock → stage; never bury the three intents.
2. **Local file honesty** — UI must keep making “PDF never leaves device” obvious.
3. **One primary action** in the dock; secondary actions stay secondary.
4. **Restrained product color** — accent for primary actions and state, not decoration soup.
5. **Familiar controls** — selects, checkboxes, drop zones, and buttons stay recognizable.

Expanded bans, token table, critique workflow, and pre-ship checklist: **`docs/journey-anti-slop.md`**.
## Conversion / proof (secondary; marketing slices only)

- Primary product CTA remains path selection → create/sign/verify, not a vague “Get started” that drops features.
- Promo seal fee must stay accurate via `sealPricing` (no invented fees).
- Blog CTAs follow blog author rules (promo fee, no site-name CTAs, no em dashes).
