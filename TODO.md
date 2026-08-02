# VeriLock — Create/Invite Path TODO

> Generated from code review (2026-08-01). High priority first.

## 🔴 High Priority

- [x] **1. Invite tokens never expire** — Set 30-day expiry in `inviteSigner.ts:281`
- [x] **2. Document link vs personal invite confusion** — Renamed to "Fallback link (not a personal invite)", clearer warning text
- [x] **3. No durable "sent" status after reload** — Already implemented; hydrates from `party.inviteEmail` + `party.inviteSentAt` server state
- [x] **4. Destructive resend without confirmation** — Added `window.confirm()` before resend when party already has active invite

## 🟡 Medium Priority

- [x] **5. No rate-limit or retry guidance** — Specific error messages for 429 (rate limit), 503 (unavailable), 502 (provider error)
- [x] **6. "Invite emailed" implies delivery** — Changed badge to "Invite sent"
- [ ] **7. Invite token in sessionStorage** — `DocumentJourney.tsx:832–915`. Clear after successful signing. Shorter lifetime.
- [x] **8. PII in server logs** — `inviteSigner.ts:292`. Mask recipient email: `j***@example.com`

## 🟢 UX Improvements

- [ ] **9. Simplify sharing hierarchy** — Too many competing concepts. Reduce to: Send invite, Copy invite, "Send PDF separately."
- [x] **10. Dense invite cards** — Collapsed resend explanation into `<details>` expandable. Key info ("Sent to X") always visible.
- [x] **11. Plural "Invite signer" for single signer** — Dynamic text: "Invite signer" / "Invite 2 signers". Updated helper text: "fallback link" not "open document link".
- [ ] **12. Waiting view feels like dead end** — Add pending signer count, last invite time, resend affordance.

## 📋 Files Changed

| File | Items |
|------|-------|
| `server/src/email/inviteSigner.ts` | #1 (30-day expiry), #8 (PII masking) |
| `client/src/journey/DocumentJourney.tsx` | #2 (fallback link rename), #4 (resend confirm), #5 (rate-limit errors), #6 (Invite sent badge), #10 (collapsed detail), #11 (dynamic plural) |

## Remaining

- **Item 7** — sessionStorage token cleanup after signing (needs investigation of signing flow)
- **Item 9** — Share hierarchy simplification (bigger UX redesign — needs discussion)
- **Item 12** — Waiting view improvements
