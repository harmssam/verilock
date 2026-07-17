# Nimiq Network Integration — VeriLock

Living reference for how **VeriLock** connects wallets, signs login challenges, broadcasts lock (attestation) transactions, and verifies proofs on the Nimiq blockchain. Official behavior is defined on [nimiq.dev](https://www.nimiq.dev); this document maps VeriLock’s implementation to those APIs and records project-specific choices (checkout vs `signTransaction`, redirect recovery, broadcast fallbacks).

**Last aligned with nimiq.dev:** July 2026

---

## Official sources

| Topic | Canonical URL | What it covers |
|-------|---------------|----------------|
| Developer Center (home) | https://www.nimiq.dev | Paths: Web Client, Hub API, Mini Apps, RPC |
| **Hub API** overview | https://www.nimiq.dev/hub | Install, popup/redirect, core methods |
| Hub getting started | https://www.nimiq.dev/hub/getting-started | Init, first `checkout`, popup-blocker rules, COOP/COEP |
| Hub core concepts | https://www.nimiq.dev/hub/guide/concepts | Architecture, redirect handlers, `checkRedirectResponse()`, state preservation |
| Hub API reference | https://www.nimiq.dev/hub/api-reference | `checkout`, `signTransaction`, `signMessage`, `chooseAddress`, `SignedTransaction` |
| Hub transactions guide | https://www.nimiq.dev/hub/guide/transactions | Checkout vs sign, Luna, message prefixing, auth example |
| Hub accounts guide | https://www.nimiq.dev/hub/guide/accounts | Third-party auth: `chooseAddress` + `signMessage` (not `login`) |
| **Mini Apps** overview | https://www.nimiq.dev/mini-apps | WebView, provider lifecycle, deeplinks (`nimiqpay://miniapp?url=…`) |
| Mini App API reference | https://www.nimiq.dev/mini-apps/api-reference | SDK `init()`, provider index |
| Nimiq Provider API | https://www.nimiq.dev/mini-apps/api-reference/nimiq-provider | `listAccounts`, `sign`, `sendBasicTransactionWithData`, etc. |
| **RPC** overview | https://www.nimiq.dev/rpc | JSON-RPC for backends |
| RPC methods index | https://www.nimiq.dev/rpc/methods | Method categories (Wallet, Mempool, Blockchain, …) |
| Hub endpoint (runtime) | https://hub.nimiq.com | Public Hub used by VeriLock (configurable via `VITE_NIMIQ_HUB_URL`) |
| `@nimiq/hub-api` types | npm package `PublicRequestTypes.ts` | Authoritative request/result types (linked from API reference) |

Individual RPC method pages (e.g. `getTransactionByHash`) are listed on the methods index; deep links may change—use the index when refreshing.

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         VeriLock (browser + Express)                       │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐ │
│  │   App.tsx    │──►│  nimiq.ts    │──►│ hubSeal      │──►│  api.ts      │ │
│  │  boot/lock   │   │ Hub + Pay    │   │ Redirect.ts  │   │  REST client │ │
│  └──────────────┘   └──────┬───────┘   └──────────────┘   └──────┬───────┘ │
│                            │                                      │         │
│         Nimiq Pay path     │         Hub path                     │         │
│              ▼             │              ▼                       ▼         │
│  ┌──────────────────┐    │    ┌──────────────────┐    ┌──────────────────┐│
│  │ @nimiq/mini-app- │    │    │  @nimiq/hub-api  │    │ server/          ││
│  │ sdk (init/sign/  │    │    │  → hub.nimiq.com │    │ nimiq-rpc.ts     ││
│  │ sendBasicTx…)    │    │    │  → Keyguard      │    │ attestations.ts  ││
│  └────────┬─────────┘    │    └────────┬─────────┘    └────────┬─────────┘│
└───────────┼──────────────┼─────────────┼───────────────────────┼───────────┘
            │              │             │                       │
            │    native    │   popup /   │                       │ JSON-RPC
            │    dialogs   │   redirect  │                       │
            ▼              ▼             ▼                       ▼
     ┌────────────┐  ┌────────────┐  ┌────────────┐      ┌──────────────────┐
     │ Nimiq Pay  │  │ Nimiq Hub  │  │ Keyguard   │      │ Nimiq RPC node   │
     │ (WebView)  │  │   (UI)     │  │ (signing)  │      │ (e.g. nimiqwatch)│
     └─────┬──────┘  └────────────┘  └────────────┘      └────────┬─────────┘
           │                                                        │
           └──────────────── broadcast ────────────────────────────┘
                                    Nimiq blockchain (Albatross)
```

**Data flow summary**

1. **Sign-in:** Wallet signs a server-issued nonce; server verifies via RPC (`verifySignature`) or local Ed25519 (Hub prefix).
2. **Lock:** Wallet signs a basic transaction with 37-byte attestation payload in `extraData` / `data`.
3. **Broadcast:** Hub `checkout` may broadcast; otherwise client RPC and/or server `sendRawTransaction`.
4. **Confirm:** Server fetches tx via RPC, checks payload, confirmations, `executionResult`, then marks document locked.

---

## Wallet modes

VeriLock picks a mode at runtime (`getWalletMode()` in `client/src/nimiq.ts`):

| Mode | Detection | Wallet API | Typical context |
|------|-----------|------------|-----------------|
| **Nimiq Pay** (`nimiq-pay`) | `window.nimiqPay` and/or `window.nimiq` after `init()` | [@nimiq/mini-app-sdk](https://www.nimiq.dev/mini-apps/api-reference/nimiq-provider) | Mini app inside Nimiq Pay; mobile deeplink |
| **Hub** (`hub`) | Default when not in Pay host | [@nimiq/hub-api](https://www.nimiq.dev/hub) → `https://hub.nimiq.com` | Desktop browser, popup or full-page redirect |

```ts
// client/src/nimiq.ts — getWalletMode()
if (isNimiqPayHost() || window.nimiq) return 'nimiq-pay'
return 'hub'
```

**Opening in Nimiq Pay:** `nimiqpay://miniapp?url=<origin>` ([Mini Apps — Sharing](https://www.nimiq.dev/mini-apps)). VeriLock only assigns this scheme on mobile (`launchNimiqPayMiniApp`).

---

## Authentication / sign-in

VeriLock uses a **challenge–response** pattern recommended for third-party Hub apps ([accounts guide — `signMessage` for authentication](https://www.nimiq.dev/hub/guide/accounts#alternative-signmessage-for-authentication)).

### Server: challenge and verify

| Step | Endpoint | Implementation |
|------|----------|----------------|
| 1. Challenge | `POST /api/auth/challenge` | `server/src/index.ts` — nonce `VeriLock sign-in:{uuid}:{timestamp}`, session token |
| 2. Verify | `POST /api/auth/verify` | Hub: `verifyHubSignedMessage` (`server/src/hub-signature.ts`); Pay: RPC `verifySignature` (`server/src/nimiq-rpc.ts`) |

Hub messages use the Keyguard prefix documented in the [transactions guide — Message Prefixing](https://www.nimiq.dev/hub/guide/transactions#message-prefixing):

```
sign(sha256(`\x16Nimiq Signed Message:\n${message.length}${message}`))
```

Pay path passes the raw nonce to RPC `verifySignature` with `isHex: true` (Nimiq Pay `sign()` returns hex `publicKey` and `signature`).

### Hub: `chooseAddress` + `signMessage`

**Popup flow** — `connectViaHub()` (`client/src/nimiq.ts`):

1. `hub.chooseAddress({ appName })` → address ([`chooseAddress`](https://www.nimiq.dev/hub/api-reference#chooseaddress))
2. `POST /api/auth/challenge` with address
3. `hub.signMessage({ appName, message: nonce, signer: address })` ([`signMessage`](https://www.nimiq.dev/hub/api-reference#signmessage))
4. Client `POST /api/auth/verify` with `authScheme: 'hub'`

**Redirect flow** (mobile-friendly, [concepts — Redirect](https://www.nimiq.dev/hub/guide/concepts#redirect)):

1. `chooseAddress` with `RedirectRequestBehavior.withLocalState({ flow: 'login' })`
2. Page navigates to Hub; on return, `setupHubRedirectHandlers()` completes the chain
3. If redirect returns from `CHOOSE_ADDRESS`, lenient parser triggers a second redirect for `signMessage` with `state.token` (`hubSealRedirect.ts`)

Registered handlers: `RequestType.CHOOSE_ADDRESS` → challenge + `signMessage`; `RequestType.SIGN_MESSAGE` → `onComplete` with hex-encoded keys (`registerHubEventHandlers` in `nimiq.ts`).

### Nimiq Pay: `init` + `connect` + `sign`

**Flow** — `connectNimiq()` / `signChallenge()` (`client/src/nimiq.ts`), orchestrated from `App.tsx` `connectWallet()`:

1. `init({ timeout })` — wait for injected provider ([Mini Apps — How it works](https://www.nimiq.dev/mini-apps#how-it-works))
2. `nimiq.connect()` — account dialog when needed (typed in SDK, not on nimiq.dev provider page)
3. `nimiq.listAccounts()` — first account
4. Server challenge + `nimiq.sign(nonce)` ([`sign`](https://www.nimiq.dev/mini-apps/api-reference/nimiq-provider#sign))
5. `POST /api/auth/verify` with `authScheme: 'pay'`

Session persisted in `sessionStorage` (`client/src/session.ts`: `token`, `address`).

### Redirect vs popup

| Concern | Popup (default on desktop) | Redirect (default for Hub lock/login on non-Pay) |
|---------|---------------------------|--------------------------------------------------|
| Hub API | Default `PopupRequestBehavior` | `RedirectRequestBehavior.withLocalState(...)` |
| Popup blockers | Risk; VeriLock shows `popupBlockedHelp()` | No popup ([getting started](https://www.nimiq.dev/hub/getting-started)) |
| Return handling | In-popup promise resolves | URL hash `#id&status&result` + `checkRedirectResponse()` |
| VeriLock extras | — | Lenient parser when `document.referrer` is empty (`hubSealRedirect.ts`) |

**Boot order:** `App.tsx` calls `setupHubRedirectHandlers()` **before** any `history.replaceState` that would strip the hash.

---

## Lock transaction flow

Locking anchors the document’s **final SHA-256** (PDF + signatures metadata) on-chain in a basic transaction’s unstructured data field (max **64 bytes** per Nimiq basic tx — noted in `nimiq.ts` / `nimiq-rpc.ts`).

### End-to-end steps

| # | Action | Code |
|---|--------|------|
| 1 | Client computes `finalSha256` | `App.tsx` → `lockDocument()` |
| 2 | `POST …/prepare-lock` | Server validates document `ready_to_lock` |
| 3 | Wallet signs attestation tx | Pay: `sendLockAttestation`; Hub: `sendLockAttestationViaHub` |
| 4 | `POST …/begin-lock` | Document status → `locking` |
| 5 | `POST …/attestations` with `txHash` | `submitAttestation` (`server/src/attestations.ts`) |
| 6 | Poll `GET …/attestations/status/:txHash` | `pollAttestation.ts` until `confirmed` |

### Attestation payload format (37-byte binary)

Built identically on client and server (`buildAttestationPayloadBytes`):

| Offset | Size | Content |
|--------|------|---------|
| 0 | 1 | Version byte `0x01` |
| 1 | 4 | First 8 hex chars of `docId` (UUID without hyphens) |
| 5 | 32 | `finalSha256` (raw bytes) |

**Total: 37 bytes** (under the 64-byte basic-tx data limit).

### Annotation stream payloads (experiment, magic `0xA1`)

Separate from seals. Multi-tx overlay frames for PDF annotations (path/text/check/X), indexed by PDF SHA-256:

| Byte | Meaning |
|------|---------|
| 0 | Magic **`0xA1`** (never `0x01` — seal verifier will reject stream txs as seals) |
| 1 | Stream version (`1`) |
| 2 | Frame type: HEAD / DATA / END |
| 3–4 | seq / total frames |
| 5–8 | PDF hash prefix |
| 9–63 | Body (55 B) |

- Cap: **32 frames** per stream (`MAX_STREAM_FRAMES`).
- Value: **1 luna** per frame (aligned with credit seal dust), fee 0.
- Broadcast: service wallet → attestation sink; feature flag `ANNOTATION_STREAM_BROADCAST` (prod requires explicit enable).
- Ownership: stream row bound to publisher wallet; overwrite only by same address.
- Reconstruct: re-read `recipientData` from each tx hash; require `executionResult !== false` and exact 64 B; optional `?fallback=index` vs `?fallback=none`.

Seal verification still requires exact 37-byte `0x01` payload — stream txs cannot satisfy `verifyAttestationPayload`.

```ts
// client/src/nimiq.ts — buildAttestationPayloadBytes()
payload[0] = ATTESTATION_PAYLOAD_VERSION // 1
// bytes 1–4: docShortId(docId) — 4 bytes from first 8 hex chars of UUID
// bytes 5–36: finalSha256 as 32 bytes
```

Legacy UTF-8 format `seal:v1:lock:{shortId}:{sha256}` is still accepted when verifying old txs (`parseAttestationPayload` / `verifyAttestationPayload` in `server/src/nimiq-rpc.ts`).

**Hub:** payload passed as `Uint8Array` in `extraData`.  
**Pay:** hex string via `buildAttestationPayload()` in `data` field of `sendBasicTransactionWithData`.

### Hub: `checkout` to attestation sink (1 luna) — not self-send, not value 0

VeriLock uses **`hub.checkout()`** for lock ([API reference — checkout](https://www.nimiq.dev/hub/api-reference#checkout), [transactions guide](https://www.nimiq.dev/hub/guide/transactions#checkout)). Hub signs **and broadcasts** the transaction.

```ts
// client/src/nimiq.ts — buildHubLockCheckoutRequest()
{
  appName: APP_NAME,
  sender: address,
  forceSender: true,
  recipient: getHubAttestationRecipient(), // ≠ sender (Hub rejects identical addresses)
  value: 1,                                // 1 luna — Hub rejects value 0
  flags: 0,
  extraData: buildAttestationPayloadBytes(docId, finalSha256),
  validityDuration: 120,
}
```

Default recipient: Nimiq Foundation (`NQ09VF5Y1PKVMRM45LE155KVP6R2GXYJXYQF`), overridable via `VITE_ATTESTATION_RECIPIENT` / `ATTESTATION_RECIPIENT`.

After checkout, VeriLock uses `hubBroadcast: true` → `finalizeHubLockTransaction()` waits up to **30s** for the tx on-network, then proceeds to attestation submission even if RPC visibility lags.

**Why not self-send via `checkout`?**

Hub **checkout** returns `Sender and Recipient cannot be identical.`

**Why not `signTransaction` + client broadcast?**

`signTransaction` does not broadcast ([transactions guide](https://www.nimiq.dev/hub/guide/transactions#signtransaction)). VeriLock’s experiments showed raw JSON-RPC `sendRawTransaction` often never landed txs in mempool. **Checkout + Hub broadcast** is the reliable path per nimiq.dev.

**Why 1 luna, not 0?**

Hub’s request parser rejects **value 0**. The 1-luna payment (~0.00001 NIM) goes to the attestation sink. The wallet must hold enough NIM or the tx mines with `executionResult: false`.

**Legacy:** Redirect handlers still accept `RequestType.SIGN_TRANSACTION` responses (`hubBroadcast: false` → `relaySignedTransaction` with server fallback).

### Nimiq Pay: zero-value self-send

```ts
// client/src/nimiq.ts — sendLockAttestation()
await nimiq.sendBasicTransactionWithData({
  recipient: address,
  value: 0,
  data: buildAttestationPayload(docId, finalSha256), // hex string
})
```

Maps to [`sendBasicTransactionWithData`](https://www.nimiq.dev/mini-apps/api-reference/nimiq-provider#sendbasictransactionwithdata). Nimiq Pay signs, sends, and returns the **transaction hash**. Fee is chosen by the wallet (often 0).

> **Gap:** Official provider docs describe `data` as a “text message”; VeriLock passes a **hex-encoded binary** payload. This works in production but is not spelled out on nimiq.dev.

### Broadcast strategy

**Hub checkout (primary):** Hub broadcasts after sign. VeriLock waits up to **30s** (`HUB_CHECKOUT_NETWORK_WAIT_MS`) for visibility, then submits the attestation anyway and lets the server poller confirm.

**Legacy `signTransaction` relay:** Used only for older in-flight redirect responses.

```
finalizeHubLockTransaction()
  ├─ hubBroadcast (checkout)? → wait up to 30s → proceed with hash either way
  └─ relaySignedTransaction()  [SIGN_TRANSACTION fallback]
        ├─ already on chain? → done
        ├─ broadcastRawTransaction (preferServer → POST /api/transactions/broadcast)
        ├─ wait up to 20s (RELAY_NETWORK_SOFT_WAIT_MS)
        └─ if broadcast attempted but not visible → proceed with hash anyway
```

| Layer | Method | File |
|-------|--------|------|
| Hub | Implicit broadcast on `checkout` | [Hub transactions — checkout broadcasts](https://www.nimiq.dev/hub/guide/transactions#checkout) |
| Client RPC | `sendRawTransaction` (lookup + relay fallback) | `nimiq.ts` → `nimiqRpcCall` |
| Server | `@nimiq/core` `Client.sendTransaction()` after consensus | `server/src/nimiq-rpc.ts` → `broadcastRawTransaction` |
| Server API | `POST /api/transactions/broadcast` | `server/src/index.ts` (auth required) |

Lookups use `getTransactionByHash`, then `getTransactionFromMempool` if not found (`transactionKnownOnNetwork`).

**Progress UI:** `setSealProgressReporter()` in `nimiq.ts` drives `lockMessage` during broadcast/wait (`App.tsx` registers on mount).

**Server broadcast fallback** is wired per session token in `App.tsx`:

```ts
createServerBroadcastFallback(token) → api.broadcastTransaction(token, serializedTx)
```

**Typical timing:** Hub sign ~10–30s (user) + network visibility ~5–30s + block confirmation ~30–90s → **~1–2 minutes** total when the wallet is funded.

### Redirect recovery (`sealInFlight`, lenient parsing)

Hub redirect return can lose `sessionStorage.rpcRequests` or `document.referrer` ([concepts — Handling Redirect Responses](https://www.nimiq.dev/hub/guide/concepts#handling-redirect-responses)). VeriLock mitigates:

| Mechanism | Storage | Purpose |
|-----------|---------|---------|
| `sealInFlight` | `localStorage` (`sealRecovery.ts`) | `slug`, `docId`, `token`, `address`, `startedAt` (1h TTL) |
| Lenient redirect | `hubSealRedirect.ts` | Parse URL hash / `?rpcId=` without Hub’s referrer check |
| `peekHubRedirectInUrl()` | URL hash | Block duplicate lock while hash present |
| `shouldResumeHubSeal()` | referrer + `sealInFlight` | Auto-resume document after Hub return |

`processLenientHubRedirect()`:

1. `readRedirectResponse()` — hash or stored `response-{rpcId}`
2. Match `loadStoredRpcRequest(id)` **or** fall back to `loadSealInFlight()`
3. For lock: `completeLockRedirect()` → `finalizeHubLockTransaction()` → `onLockComplete`
4. For login: resume `chooseAddress` → `signMessage` chain

On lock redirect start, `markSealRedirectStarted()` saves `sealInFlight`; cleared in `finishLock()` on success or on lock error.

**Boot hub-return UX** (`App.tsx`):

1. `setupHubRedirectHandlers()` returns `{ redirectHandled, lockCompletion }` — boot **awaits** `lockCompletion` before continuing.
2. `hydrateHubReturnDocument()` immediately sets screen, session, `busy`, and loads the document so the seal card is visible (not a blank page).
3. Orphaned `sealInFlight` (no URL hash / `rpcId` left to process) is cleared on boot to avoid stale notices after refresh.
4. `shouldShowStaleSealNotice()` skips when attestation already `failed` or doc is `locking` (SealCard handles those cases).

---

## On-chain verification

Server-side proof checking lives in `verifyAttestation()` (`server/src/nimiq-rpc.ts`), invoked from `resolveAttestation()` (`server/src/attestations.ts`).

### Checks (in order)

1. **Transaction exists** — `getTransactionByHash`, else `getTransactionFromMempool`
2. **Confirmations** — `tx.confirmations >= NIM_MIN_CONFIRMATIONS` (default `1`)
3. **`executionResult`** — must be `true` (failed txs rejected with hint to fund Hub wallet with ~0.01 NIM)
4. **Sender** — `tx.from` matches session `senderAddress`
5. **Value** — self-send: `0` or `1` luna; non-self-send: optional `ATTESTATION_RECIPIENT` sink (production default: Nimiq Foundation vesting contract)
6. **Payload** — `recipientData` bytes match `buildAttestationPayloadBytes(docId, finalSha256)`

### Attestation lifecycle

| Status | Meaning |
|--------|---------|
| `pending` | Tx not found yet, low confirmations, or RPC delay |
| `confirmed` | All checks pass; `lockDocument()` sets document `locked` |
| `failed` | Invalid payload, wrong sender, `executionResult: false`, or not on chain after ~45s |

Background poller: every 5s, pending attestations younger than 120s (`startAttestationPoller`). Client polls every 3s via `pollAttestation()`.

**Local dev:** `SKIP_CHAIN_VERIFY=true` skips RPC verification (never use in production).

---

## Environment variables

### Client (Vite — prefix `VITE_`)

| Variable | Default | Used in |
|----------|---------|---------|
| `VITE_NIMIQ_HUB_URL` | `https://hub.nimiq.com` | `client/src/nimiq.ts` — `HubApi` endpoint |
| `VITE_NIMIQ_RPC_URL` | `https://rpc.nimiqwatch.com` | Client-side `sendRawTransaction` / tx lookup |
| Hub `appName` | `VeriLock` (hardcoded in `client/src/nimiq.ts`) | Label shown in Hub / Pay approval dialogs |
| `VITE_ATTESTATION_RECIPIENT` | Nimiq Foundation (see `getHubAttestationRecipient`) | Hub checkout recipient (must ≠ sender) |
| `VITE_API_URL` | `''` (same origin) | `client/src/api.ts` — dev proxy vs production monolith |

### Server

| Variable | Default | Used in |
|----------|---------|---------|
| `NIMIQ_RPC_URL` | `https://rpc.nimiqwatch.com` | `server/src/nimiq-rpc.ts` |
| `NIM_MIN_CONFIRMATIONS` | `1` | `verifyAttestation` |
| `ATTESTATION_RECIPIENT` | (prod: Nimiq Foundation vesting) | Non-self-send attestations only |
| `SKIP_CHAIN_VERIFY` | unset | Skips on-chain verify when `true` |
| `NODE_ENV` | — | Enables default attestation recipient in production |
| `DATA_DIR` / `PORT` / `CORS_ORIGIN` | — | Deployment; not Nimiq-specific |

See `.env.example` at repo root for a full template.

---

## Failure modes & troubleshooting

| Symptom | Likely cause | VeriLock behavior / fix |
|---------|--------------|---------------------|
| “Pop-up blocked” | Hub popup not opened synchronously from click | Use redirect (`preferRedirect`) or Nimiq Pay; see [getting started — popup rules](https://www.nimiq.dev/hub/getting-started) |
| “Redirecting to Nimiq Hub…” then stall | User still in Hub or hash not processed | Ensure boot calls `setupHubRedirectHandlers` first; check URL for `#id&status&result` |
| Stale seal notice | `sealInFlight` set but redirect incomplete | `staleSealMessage()` — signatures saved; tap **Retry seal** |
| “Sealing…” for 1–2+ minutes | Normal: Hub sign + broadcast wait + block confirmation | Watch `hub:progress` logs; should complete in ~1–2 min when funded |
| Blank page after Hub return (fixed) | `activeDoc` not loaded until async lock finished | Boot now hydrates document + shows “Completing seal after Hub…” |
| “Transaction was signed in Hub but did not reach the Nimiq network” | Legacy `signTransaction` relay could not see tx | Current path uses `checkout` + Hub broadcast; retry after hard refresh |
| “Seal transaction was not found on the blockchain” | Tx never mined / wrong hash | After ~45s pending with “not found”, attestation marked failed (`markAttestationFailed`) |
| `executionResult: false` | Insufficient Hub wallet balance | Fund wallet with ~0.01 NIM; retry seal; Pay path uses `value: 0` |
| “Sender and Recipient cannot be identical” | Hub checkout with self-send | Checkout uses `getHubAttestationRecipient()` sink instead |
| Duplicate stale + failed notices on refresh | `sealInFlight` orphan + failed attestation | Orphan cleared on boot; stale notice suppressed when attestation `failed` |
| Auto-redirect loop after Hub error | `autoLock` retried immediately after failed redirect | Auto-lock runs once per visit; tap **Retry seal** manually |
| Login “session expired” on redirect | Missing `state.token` in stored RPC request | Re-connect wallet; lenient path requires `token` in `SIGN_MESSAGE` state |
| Nimiq Pay “wallet not found” on desktop | No injected provider outside Pay | Use Hub path (`getWalletMode() === 'hub'`) |
| Hub redirect lost `rpcRequests` | Cross-site `sessionStorage` cleared | `sealInFlight` fallback in `processLenientHubRedirect` |
| Attestation pending forever | RPC lag or low confirmations | Wait for poller; increase patience or check `NIMIQ_RPC_URL` |

**Debug logging:** `sealLog` / `sealWarn` / `sealError` in `client/src/sealDebug.ts` (grep console for `[verilock]` and hub labels).

**COOP/COEP:** Do not set cross-origin isolation headers — they break Hub popups ([getting started](https://www.nimiq.dev/hub/getting-started)).

---

## Keeping this doc up to date

When changing wallet, lock, or verify flows, re-check these nimiq.dev pages:

- [ ] https://www.nimiq.dev/hub/api-reference — method signatures, `extraData`, `SignedTransaction`
- [ ] https://www.nimiq.dev/hub/guide/transactions — checkout vs `signTransaction`, Luna, message signing
- [ ] https://www.nimiq.dev/hub/guide/concepts — redirect behavior, `checkRedirectResponse`, state preservation
- [ ] https://www.nimiq.dev/hub/getting-started — popup-blocker guidance, COOP/COEP
- [ ] https://www.nimiq.dev/hub/guide/accounts — third-party authentication pattern
- [ ] https://www.nimiq.dev/mini-apps — deeplink format, security model
- [ ] https://www.nimiq.dev/mini-apps/api-reference/nimiq-provider — Pay sign/send methods
- [ ] https://www.nimiq.dev/rpc/methods — `sendRawTransaction`, `getTransactionByHash`, `verifySignature`, `getTransactionFromMempool`

**Also verify in repo:**

- [ ] `client/src/nimiq.ts` — Hub/Pay entry points, payload, broadcast
- [ ] `client/src/hubSealRedirect.ts` / `hubRedirectParse.ts` / `sealRecovery.ts`
- [ ] `client/src/App.tsx` — boot, `connectWallet`, `lockDocument`, `finishLock`
- [ ] `server/src/nimiq-rpc.ts` / `attestations.ts` / `hub-signature.ts`
- [ ] `.env.example` and `README.md` deploy vars
- [ ] `@nimiq/hub-api` and `@nimiq/mini-app-sdk` version bumps in `client/package.json`

---

## Code path quick reference

| Behavior | Primary file | Key functions |
|----------|--------------|---------------|
| Wallet mode | `client/src/nimiq.ts` | `getWalletMode`, `isNimiqPayHost`, `probeNimiqPay` |
| Hub login | `client/src/nimiq.ts` | `connectViaHub`, `setupHubRedirectHandlers` |
| Pay login | `client/src/nimiq.ts` | `connectNimiq`, `signChallenge` |
| Hub lock | `client/src/nimiq.ts` | `sendLockAttestationViaHub`, `buildHubLockCheckoutRequest`, `finalizeHubLockTransaction`, `setSealProgressReporter` |
| Pay lock | `client/src/nimiq.ts` | `sendLockAttestation` |
| Redirect parse | `client/src/hubSealRedirect.ts` | `processLenientHubRedirect` |
| Seal recovery | `client/src/sealRecovery.ts` | `saveSealInFlight`, `loadSealInFlight`, `shouldResumeHubSeal` |
| UI orchestration | `client/src/App.tsx` | `connectWallet`, `lockDocument`, `finishLock`, boot `useEffect` |
| Session | `client/src/session.ts` | `saveSession`, `loadSession` |
| RPC + verify | `server/src/nimiq-rpc.ts` | `verifyAttestation`, `broadcastRawTransaction`, `verifySignature` |
| Hub sig verify | `server/src/hub-signature.ts` | `verifyHubSignedMessage` |
| Attestation DB | `server/src/attestations.ts` | `submitAttestation`, `resolveAttestation`, `markAttestationFailed` |

---

## Documentation gaps (official vs VeriLock)

| Topic | Official docs | VeriLock behavior |
|-------|---------------|---------------|
| Hub `value: 0` | Not documented as forbidden | VeriLock uses **1 luna** to attestation sink for Hub checkout |
| Hub checkout self-send | Not documented | Hub returns **Sender and Recipient cannot be identical** |
| `sendBasicTransactionWithData.data` | Described as “text message” | VeriLock sends **hex-encoded 37-byte binary** |
| `nimiq.connect()` | Not on nimiq.dev provider page | Required before `listAccounts` in VeriLock (`provider.d.ts` only) |
| `signTransaction` for attestations | Fully documented | VeriLock **uses `checkout`** for lock; `signTransaction` only as legacy redirect fallback |
| Per-method RPC pages | Index exists; some deep URLs 404 | VeriLock uses methods listed in RPC overview/index |
| `Client.sendTransaction` vs raw RPC | Docs recommend `@nimiq/core` for broadcast | Server uses `Client.sendTransaction()`; client uses JSON-RPC for lookups |
| `ATTESTATION_RECIPIENT` | N/A (app-specific) | Hub checkout pays 1 luna to this sink; server verifies `tx.to` matches |

These gaps are intentional integration choices unless/until nimiq.dev documents them otherwise.