# VeriLock — Create/Invite Path TODO

> Generated from code review (2026-08-01). High priority first.
> Last updated: 2026-08-01 (all staging-deployed, not yet on prod).

## 🔴 High Priority

- [x] **1. Invite tokens never expire** — Set 30-day expiry in `inviteSigner.ts:281`
- [x] **2. Document link vs personal invite confusion** — Renamed to "General link", clarified "doesn't specify a signer"
- [x] **3. No durable "sent" status after reload** — Already implemented; hydrates from `party.inviteEmail` + `party.inviteSentAt` server state
- [x] **4. Destructive resend without confirmation** — Added `window.confirm()` before resend when party already has active invite

## 🟡 Medium Priority

- [x] **5. No rate-limit or retry guidance** — Specific error messages for 429 (rate limit), 503 (unavailable), 502 (provider error)
- [x] **6. "Invite emailed" implies delivery** — Changed badge to "Invite sent"
- [x] **7. Invite token in sessionStorage** — `DocumentJourney.tsx:832–915`. 30-min TTL, cleared after successful signing.
- [x] **8. PII in server logs** — `inviteSigner.ts:292`. Mask recipient email: `j***@example.com`

## 🟢 UX Improvements

- [ ] **9. Simplify sharing hierarchy** — Too many competing concepts. Reduce to: Send invite, Copy invite, "Send PDF separately."
- [x] **10. Dense invite cards** — Collapsed resend explanation into `<details>` expandable. Key info ("Sent to X") always visible.
- [x] **11. Plural "Invite signer" for single signer** — Dynamic text: "Invite signer" / "Invite 2 signers". Helper text references "general link".
- [x] **12. Waiting view feels like dead end** — Added pending signer count, last invite time, "Resend invites" button.

## 🧹 Other Work Done Today (2026-08-01)

- [x] **Staging env** — Created Railway staging env; disabled prod GitHub auto-deploy (manual `railway up` for both)
- [x] **Draft expiry** — IndexedDB create-path draft: 24h → 2h, defensive age check (never expires with missing `savedAt`)
- [x] **Dead code cleanup** — Deleted `PdfDropZone.tsx` (274 lines, never rendered); extracted `formatFileSize.ts`; removed 97 lines of dead CSS. Net -351 lines.
- [x] **Drop zone visual polish** — kimi-k3: circular icon backdrop with hover glow, refined title typography
- [x] **Leaner drop zone** — kimi-k3: removed doc-stage border, doc-card outline, thinned spine 10px→3px. Borders now appear ONLY on drag (`doc-stage--dragging`).
- [x] **Tweaks** — Removed em dash, darkened hint text (#94a3b8→#64748b), dropped icon ring border
- [x] **General link rename** — "Fallback link" → "General link", clarified "doesn't specify a signer"

## 📋 Files Changed

| File | Items |
|------|-------|
| `server/src/email/inviteSigner.ts` | #1 (30-day expiry), #8 (PII masking) |
| `client/src/journey/DocumentJourney.tsx` | #2 (general link), #4 (resend confirm), #5 (rate-limit errors), #6 (Invite sent badge), #7 (token TTL), #10 (collapsed detail), #11 (dynamic plural), #12 (waiting view) |
| `client/src/journey/journeyPdfDraft.ts` | Draft expiry 24h→2h |
| `client/src/journey/PdfDropZone.tsx` | DELETED |
| `client/src/journey/formatFileSize.ts` | NEW (extracted utility) |
| `client/src/journey/DocumentStage.tsx` | doc-card empty state polish |
| `client/src/journey/Journey.css` | dead CSS removal, drop zone leanness, waiting-view status |

## Commit History (staging)

| Commit | What |
|--------|------|
| `cb834b1` | General link rename + #7 invite token TTL |
| `c6e13c0` | TODO.md update |
| `109b520` | Leaner drop zone — remove borders, thin spine |
| `502f3e7` | Remove em dash, darken hint, drop icon ring border |
| `c1bbede` | Dead code cleanup (-351 lines), doc-card polish |
| `db005f4` | Drop zone visual polish (was dead code) |
| `93e55b7` | Draft expiry 24h→2h, defensive age check |
| `3d5e873` | Invite: 30-day expiry, fallback link, resend confirm, PII mask, errors |

## Remaining

- **Item 9** — Share hierarchy simplification (bigger UX redesign — needs discussion)
- **Prod deploy** — staging verified, `railway up` to ship to prod when ready
