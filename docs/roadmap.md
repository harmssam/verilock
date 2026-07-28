# VeriLock product roadmap

Living document for product direction. Revisit after demos and releases; adjust order freely.

**Last updated:** 2026-07-28

**North star:** Free multi-party signing with wallet identity + optional permanent on-chain proof — without ever uploading the document.

DocuSign wins on envelope UX, routing, and enterprise workflow. VeriLock should win on **privacy, permanence, cost honesty, and cryptographic integrity** — not by cloning DocuSign’s document-hosting model.

---

## Design principles (every feature)

Because VeriLock never holds the file:

1. **Anything “about the PDF” stays client-side** (hash, print, overlay reconstruct).
2. **Server only stores** hash(es), party/wallet state, placements, signature ink hashes/blobs, and chain pointers.
3. **“Access the document” never means “download from us.”** It means access the *agreement record*, progress, invites, and verification path — or requiring a secret to *match* a seal.

---

## Where we are today (code-backed snapshot)

| Capability | Status |
|------------|--------|
| Create / invite / multi-party wallet sign / free complete / optional lock | Production |
| Local SHA-256 fingerprint (PDF + images) | Production |
| Personal email invites + open share links | Production |
| Placement / signature boxes (`pdfAnnotationUi`) | In journey when flagged |
| Sign on mobile (QR handoff) | Production |
| Credits + Stripe + NIM | Production |
| On-chain data archive (signatures/fields) | Production |
| Certificate JSON (`/api/documents/:id/certificate`) | Thin audit snapshot |
| Creator cancel (draft) / purge after full on-chain backup | Production |
| Party `status: 'declined'` | **Schema/types only — no decline API or UI** |
| Document `cancelled` status | Exists; mid-flight void UX is limited |
| Support | Contact form creates tickets + email; operator queue in `/admin` (user ticket list / magic link still TODO) |
| Admin | Password + Turnstile; stats **and** support ticket queue |
| Templates, reminders, expiration, signing order, bulk send, public API | **Missing** |
| Password / access code on agreements | **Missing** |

---

## Sequencing (practical)

```text
Now          Stabilize for presentation — no risky cutovers
Next         Support portal v1 remainder (customer ticket list + FAQ)
Then         Decline + reason (schema half-done — high ROI)
             Void with reason + expiration
             Access code + password-bound fingerprint
             Reminders + agreements hub filters
             Certificate / audit trail upgrade
Later        Signing order + CC/viewer roles
             Templates (recipes + placements)
             Field completeness (date, initials, required)
             Packages, confidential seals polish
             Public API + webhooks + bulk send
             Teams / branding
Postponed    Domain move → verilockdocs.com (after presentation;
             only when we can soak dual-domain + full redirect QA)
Always       Placement/print polish, email reliability, offline companion
```

---

## Stabilize for presentation (current focus)

**Goal:** Demo-safe production on `verilock.online`. No domain cutover, no large new features, no half-migrated systems.

### Already landed (demo-critical)

| Fix | Commit / area |
|-----|----------------|
| Admin support queue infinite refetch → 429 / timeouts | `692a22e` — callback refs + no-op count updates |
| Support tickets + ops queue + auto-reply + templates | `3f1256f`, `dc50f10` |
| Hub `chooseAddress` so new wallets can onboard | `2350a9c` |
| `#lr-paths` scroll after SPA mount (Chrome) | `eef203e` |
| Desktop Pay QR login reuse / dual login harden | `8e28747`, `ddae50f` |
| Check/X, name/date prefill, mobile ink, Done step | signing UX series |
| Server per-route canonical injection (no hardcode on `/`) | `ca3de46`; verify script aligned 2026-07-28 |
| Landing hero still + plate width | `fdf8de7`, `a072831` |

### Presentation gate checklist

Run before any live demo:

- [ ] `npm run test:production --prefix client` green
- [ ] `npm run test:document-kinds --prefix client` + `test:placement` green
- [ ] Client + server `tsc --noEmit` clean
- [ ] Fresh wallet can log in (Hub chooseAddress path)
- [ ] Create → place fields → invite link → second wallet signs → free complete / print
- [ ] Mobile sign QR handoff (if demoing mobile)
- [ ] Credits chip / pricing path (if demoing lock)
- [ ] `/support` submit shows `VL-…` reference; `/admin` Support tab loads without 429 loop
- [ ] Home path cards + `#lr-paths` scroll; `/pricing`, `/blog` deep links
- [ ] Production deploy matches `main` (no stale admin/support bundle)

### Out of scope until after presentation

- Domain move to `verilockdocs.com`
- Customer magic-link ticket portal
- Decline / void / access codes / templates product work
- Public API, bulk send, teams

---

## Phase 0 — Foundation

### 0.1 Domain: `verilockdocs.com` — **POSTPONED**

**Status:** Do not schedule until after the presentation and a deliberate stability window.

**Why postpone:** Cutover touches DNS, TLS, CORS, Stripe return/webhook URLs, Resend from-domain and deep links, Turnstile hostnames, invite packages, OG/SEO, and every absolute URL. A half-migrated domain mid-demo is an unacceptable risk.

**When we pick it up:**

- DNS + TLS for apex + `www`
- Redirect matrix: `verilock.online` → new domain (301), keep `/d/:slug` and `/v/:slug` working forever
- Env updates: `PUBLIC_APP_URL`, `APP_PUBLIC_URL`, `CORS_ORIGIN`, Stripe, Resend, Turnstile
- Optional: `admin.verilockdocs.com` vs keep `admin.verilock.online`
- SEO: sitemap, `llms.txt`, OG URLs, blog canonicals
- Offline companion / README / marketing assets
- Full string audit for `verilock.online` before hard cutover
- Prefer dual-domain period (both hosts serve the same app) before mandatory redirect

**Risk:** Broken invite emails and Stripe webhooks if any absolute URL is hardcoded.

---

### 0.2 Support Portal (v1) — **IN PROGRESS**

**Shipped (operator slice + auto-reply / templates):**

- `POST /api/support/contact` creates a `support_tickets` row (+ first message); best-effort email to ops inbox
- **Customer auto-reply** on submit (when Resend enabled); full text logged on the ticket thread
- All **outbound customer emails** (auto-reply + operator replies) stored on the thread with **Emailed** marker
- Success UI shows ticket reference (`VL-…`)
- Document slug auto-extracted from `/d/…` in subject/message
- `/admin` → **Support** tab: list, filter, search, thread, status, email reply, internal notes
- **Canned templates**: Nimiq wallet, wallet mismatch, free vs lock, lock failed, credits, invite, re-verify, ack
- Statuses: `open` · `in_progress` · `waiting_customer` · `resolved` · `closed`

**Still TODO for full v1:**

- Ticket list for submitters (email magic link and/or wallet-bound tickets)
- FAQ + known issues on `/support`
- Diagnostic bundle / SLA timestamps (v1.5)

#### Explicit non-goals for v1

- Full Zendesk/Intercom clone
- Live chat
- Phone support
- Uploading user PDFs into tickets

---

## Phase 1 — Signing lifecycle parity

Closest DocuSign gaps that fit the hash-only model. Includes decline + password ideas.

### 1.1 Signer decline + reason

**Schema already anticipates this** (`party.status: 'declined'` in client types / party records), but there is no API or UI path.

**Product:**

- Signer opens agreement → **Decline** (secondary to Sign)
- Required short reason (free text + optional presets: “Wrong party,” “Terms unacceptable,” “Need changes,” “Not authorized”)
- Wallet-bound action (same auth as sign) so decline is attributable
- Document stops collection when any *required* party declines (recommend: full stop; see open decisions)
- Creator notified (email if notify UI + address known; always visible on agreement)
- Party list shows declined + reason (participants only; public viewers see redacted status)
- Block further signatures; lock disabled
- Optional later: creator can **reopen** (reset declined party to pending, clear reason) with audit trail

**Hash-only note:** Reason lives in metadata only; the PDF is unchanged. No server-side VOID watermark (we don’t host the file). Optional polish: client-side “mark declined” print banner if they still have the file.

### 1.2 Creator void (mid-flight cancel with reason)

We can cancel drafts / purge backed-up docs; mid-signature void with a clear story is weaker than DocuSign.

**Product:**

- Creator voids while `collecting_signatures` / before lock
- Reason required; all pending parties notified when possible
- Status `cancelled` with `voidedAt`, `voidReason`, `voidedBy`
- Signed parties retain signature records for audit (“was voided after N signatures”)
- Cannot void after `locked` (immutable by design)

### 1.3 Agreement access password

**Two different secrets — keep them distinct in UX.**

| Mode | What it protects | DocuSign analog |
|------|------------------|-----------------|
| **A. Access code** | Who can open the agreement record (title, parties, progress, sign) | Recipient access code |
| **B. Password-bound fingerprint** | What hash is sealed / matched | No clean DocuSign analog — VeriLock differentiator |

#### A. Access code (gate the *record*)

- Creator sets optional access code at create/share
- Store only `scrypt` / `argon2id` hash of code (never plaintext)
- `GET /api/documents/:id` and invite redeem require code (header or session after unlock)
- Public verify-by-file can stay open; browsing by slug is gated (product choice — see open decisions)
- Share UX: “Link + access code sent separately”

#### B. Password-bound fingerprint

**Problem with sealing raw `SHA256(file)`:** anyone with the same file (or a public template) can match the seal forever.

**Password-bound seal (client-derived):**

```text
fileHash     = SHA256(fileBytes)          // local only
accessSecret = user password / passphrase
boundHash    = HMAC-SHA256(accessSecret, fileHash)   // prefer HMAC over naive concat
```

- Server and chain store **`boundHash` only** (or dual-mode: open vs confidential)
- To **sign / verify / lock**, each party must supply the same password locally
- Without password: file alone cannot match the sealed proof
- Without file: password alone is useless
- Password never sent to server (derive bound hash client-side, send only the hex)

**Modes at create:**

1. **Open fingerprint** (today) — anyone with the file can verify
2. **Shared secret** — parties need file + password to match/sign/verify
3. **Optional dual:** store `fileHash` privately for creator recovery; seal `boundHash` on-chain

**UX copy:** “This is not encrypting your PDF. It binds the proof so only people with the file *and* the passphrase can match it.”

**Security notes:**

- Rate-limit failed unlocks server-side (access code)
- Weak passwords + stolen file ⇒ offline brute force of bound hash — enforce length/strength guidance
- Never put password in query strings; fragment or separate channel only

### 1.4 Expiration + automatic void

- Creator sets “sign by” date
- On-read check and/or job marks expired, voids pending
- Countdown on dock + agreements list
- Optional: auto-email N days before expiry

### 1.5 Reminders (lightweight)

- Creator: “Remind” per pending party (rate-limited)
- Optional scheduled reminders (every 3 days, max N)
- When invite email exists: email nudge
- Otherwise: “copy reminder text” for WhatsApp/Slack (fits out-of-band file model)

---

## Phase 2 — Workflow depth

DocuSign-style workflow, re-interpreted for hash-only + wallet identity.

### 2.1 Signing order (sequential routing)

Today: concurrent open slots (race-friendly).

- Optional **ordered parties** (`sort_order` already exists on parties)
- Party N cannot claim/sign until N−1 signed
- Concurrent remains default for fast consumer flows

### 2.2 Roles beyond signer

| Role | Behavior |
|------|----------|
| **Signer** | Required wallet signature (today) |
| **Approver / reviewer** | Wallet approve message, not ink pad |
| **CC / viewer** | Link + completion notice; cannot sign |
| **In-person host** | Later / careful legally — optional wet-signature attestation |

### 2.3 Templates (VeriLock-native)

DocuSign templates include the document body. We cannot store the document.

**VeriLock templates:**

- **Placement template:** page boxes, field types, party count, roles, default title pattern
- **Agreement recipe:** type (rental/NDA), required signers, metadata fields, expiration default, password mode, notify prefs
- “Use again” from a completed agreement (clone roster + placements; user re-drops file)

Placement plans keyed by SHA-256 already exist — extend into **named reusable recipes**.

### 2.4 Richer fields (finish placement product)

- Signature / initials / name / date / text / checkbox (partially present in annotation types)
- Required vs optional fields
- Conditional fields later
- Print/export remains client-side reconstruct

### 2.5 Certificate of completion (upgrade)

Current certificate is a JSON snapshot. Upgrade:

- Human-readable PDF **generated client-side** (or server from metadata only): parties, wallets, timestamps, tx hash, explorer link, file hash / bound hash, decline/void events
- Event log table: created, invited, viewed (optional), signed, declined, voided, locked, archived
- “Copy audit trail” + deep link to offline verifier companion

### 2.6 Agreements hub 2.0

Grow `/agreements` toward a Manage tab:

- Filters: needs my signature / waiting on others / ready to lock / locked / declined / voided / expired
- Activity feed per document
- Bulk archive / bulk remind
- Search by title, slug, counterparty name

---

## Phase 3 — Differentiating features

Play to **hash-only + chain**, not DocuSign clones.

### 3.1 Dual-mode privacy seal

- **Public verify:** raw file hash on-chain (today)
- **Confidential seal:** bound hash only; even explorers don’t reveal which file
- Line: *“Proof without disclosure.”*

### 3.2 Selective disclosure verify

- Drop file → local hash → optional password → match API returns lock status + tx + timestamp
- Minimal reveal mode for public links (hide party names — partly done via `participantDetailsRevealed`)

### 3.3 Hash commitment before reveal

Creator posts `commitment = H(fileHash || nonce)` first; later opens with file + nonce. Timed releases / sealed bids. Niche, on-brand.

### 3.4 Multi-document packages

One envelope of several fingerprints (lease + addendum + ID page):

- Package ID, ordered list of hashes
- Sign once over package Merkle root (or sequential per file)
- User drops each file when signing/verifying — still no upload

### 3.5 Offline-first kit

Companion: [clevertech-os/verilock-offline](https://github.com/clevertech-os/verilock-offline).

- Deep link from sealed agreement → offline app with hash prefilled
- QR of certificate payload for air-gapped verify
- USB “evidence pack”: certificate JSON + tx proof (no PDF required for chain check)

### 3.6 Time-locked semantics

Optional metadata: “considered effective only after lock tx confirms.” Product semantics on existing attestation poll.

### 3.7 Signer identity upgrades (without eating free tier)

- Wallet remains primary
- Email attestation via invite redeem (exists)
- Optional legal name + typed consent in wallet payload
- Future: passkey / ID as *additional* claim — never required for public verify

---

## Phase 4 — Growth & platform

### 4.1 Public API + webhooks

```text
POST /v1/agreements     { title, fileHash, parties, options }
POST /v1/agreements/:id/invites
GET  /v1/agreements/:id
Webhooks: signed | declined | ready_to_lock | locked | voided
```

Auth: API keys bound to creator wallet or service account. **Never accept file bytes.**

### 4.2 Bulk send (CSV)

Same placement recipe × N counterparties:

- CSV: name, email, role
- Creates N agreements (each own id/slug; same `fileHash` if same PDF)
- Creator drops file once locally, reuses hash for all creates
- Password mode: per-recipient code or shared

### 4.3 PowerForm-style “request signature” page

Constraint: without a shared file, hash-based multi-party breaks. UX must teach “send the PDF separately.”

### 4.4 Teams / organizations

- Shared credit pool
- Org-owned agreements list
- Roles: admin / sender / viewer
- Wallet-first; org is overlay

### 4.5 Branding

- Custom logo on share/invite emails and print certificate
- Custom subdomain later (`acme.verilockdocs.com`) — only after primary domain strategy is settled

### 4.6 Integrations (thin)

Priority: things that don’t need the PDF.

- Webhook → Zapier/Make
- Notion/Airtable row on lock
- Calendar deadline from expiration

Skip deep Drive/Dropbox *upload* integrations that fight the privacy model.

---

## Phase 5 — Explicit non-goals (or “not yet”)

| DocuSign-style feature | Why hold back |
|------------------------|---------------|
| Hosted document viewing | Core differentiator is *not* doing this |
| Cloud OCR / AI review of full text | We never see the text; client-side LLM optional later |
| In-app payments on the envelope | Credits exist; invoice collection is a different product |
| Full CLM / clause library | Wrong product category |
| SMS OTP as primary identity | Optional 2FA later; wallet remains primary |
| Notary / eNotary networks | High compliance cost; revisit with partners |
| Editing the PDF on server | Client-only edits only |

---

## Feature map: DocuSign → VeriLock

| DocuSign | VeriLock approach |
|----------|-------------------|
| Upload PDF to envelope | Local fingerprint; file OOB |
| Recipient access code | Access code on agreement record |
| Decline to sign | Decline + reason (Phase 1) |
| Void envelope | Creator void + reason (Phase 1) |
| Expiration / reminders | Deadline + remind emails (Phase 1) |
| Templates | Placement + recipe templates (Phase 2) |
| Signing order | Ordered party claim (Phase 2) |
| CC recipients | Viewer role (Phase 2) |
| Certificate of completion | Metadata certificate + client PDF + chain link |
| Bulk send | N agreements, same hash, CSV parties (Phase 4) |
| API / webhooks | Hash-only API (Phase 4) |
| Audit trail | Event log + wallet signatures + tx |
| Document encryption at rest on their servers | N/A — password-bound *proof* instead |
| In-app document markup stored on server | Placement coords + ink only; PDF stays local |

---

## Highest-ROI bets (if we only ship a few)

1. **Support portal** — operational maturity; start here after presentation.
2. **Decline + void with reasons** — table stakes; `declined` already in types.
3. **Password-bound fingerprint** — unique differentiator DocuSign can’t copy without rebranding their model.
4. **Signing order + expiration** — multi-party reliability.
5. **Certificate people can actually show** — trust UX.
6. **`verilockdocs.com`** — brand/SEO later, only with a safe dual-host plan.

---

## Open product decisions

Lock these before implementing the related phase:

1. **Domain:** dual-host period length and hard cutover date (postponed until after presentation).
2. **Password:** access code only, bound-hash only, or both modes from day one?
3. **Decline:** voids whole agreement vs allows remaining parties to continue? *(Recommend: required-party decline → full stop.)*
4. **Public verify by slug** vs **verify only by dropping file** when access code is set.
5. **Support auth:** email magic link vs wallet-only vs either.
6. **Support ownership:** extend `/admin` vs separate operator UI.

---

## Implementation notes (for agents)

- Production UI only: `client/src/App.tsx` + `client/src/landing/` + `client/src/journey/` (see `AGENTS.md`, `PRODUCT.md`).
- Document lifecycle: `server/src/documents.ts`, `server/src/db.ts` (`DocumentStatus`, party statuses).
- Support today: `client/src/SupportPage.tsx`, `server/src/supportContact.ts`.
- Admin today: `client/src/admin/`, `server/src/admin.ts`.
- Feature flags: `client/src/features.ts` + server `/api/features`.
- Do not treat `client/src/archive/` as product work.
- Feature parity law in `PRODUCT.md` applies to redesigns; this roadmap is for *new* capabilities and must be explicit product work, not sneaked in via restyle.

---

## Changelog

| Date | Note |
|------|------|
| 2026-07-28 | Initial roadmap from product discussion. Domain postponed; Support Portal as first likely ship after presentation. |
| 2026-07-28 | Support portal operator slice: tickets on contact form + `/admin` queue (list/filter/reply). User-facing ticket list still open. |
| 2026-07-28 | Support: customer auto-reply logged on ticket; canned reply templates (wallet / lock / credits). |
| 2026-07-28 | Stabilize focus: admin queue 429 loop fixed; production verify aligned with server canonical injection; presentation gate checklist added. |
