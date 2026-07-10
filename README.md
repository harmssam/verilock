# VeriLock

PDF signer mini app for [Nimiq Pay](https://nimiq.com/nimiq-pay/) — sign agreements and anchor document SHA-256 hashes on the Nimiq blockchain.

Built for the [Mini Apps Competition](https://miniappscompetition.com/).

**Live demo:** [https://verilock.online/](https://verilock.online/) (Railway)

> **UI source of truth:** **Journey Edition** in `client/src/experiment/` (default `npm run dev` / `npm run build`).  
> The pre-journey SPA (`client/src/App.tsx`) is legacy/recovery only. Contributors and agents: see **`AGENTS.md`**.

## What it does

1. **Fingerprint** a PDF locally (rental agreement, contract, etc.) — the file never leaves your device
2. **(Optional)** Share the agreement link and send the same PDF to other signers out-of-band
3. **Sign** (optional) — each party verifies their PDF matches, then signs via Nimiq wallet
4. **Direct seal option** — for already-signed PDFs or docs that need no signatures: just fingerprint and seal the hash yourself in one step
5. **Lock** — Nimiq transaction anchors `seal:v1:lock:{docId}:{sha256}` on-chain (creator attests)
6. **Verify** — anyone can upload a PDF or enter a doc ID to check integrity

## Quick start (local)

**Requirements:** Node.js 22+

```bash
cd verilock
npm install
npm install --prefix server
npm install --prefix client

SKIP_CHAIN_VERIFY=true npm run dev
```

- **UI:** http://localhost:5176 (journey SPA — production UI)
- **API:** http://localhost:3002/api/health

Legacy (pre-journey) UI: `npm run dev:legacy` → http://localhost:5174

### Try in Nimiq Pay

1. Run `npm run dev` and note the **Network** URL (e.g. `http://192.168.1.42:5176`)
2. Open **Nimiq Pay** → **Mini Apps** → enter that URL
3. Connect wallet, upload a PDF, sign, and lock

## Deploy to Railway

VeriLock deploys as a **single service**: Express API + static client from one URL (ideal for mini apps — no CORS headaches).

### 1. Create project

```bash
railway init
railway up
```

### 2. Add a persistent volume

In the Railway dashboard:

1. Open your service → **Volumes** → **Add Volume**
2. Mount path: `/data`
3. Set environment variable: `DATA_DIR=/data`

This keeps SQLite (`verilock.db`) across deploys. PDF files are not stored — only document fingerprints and signing metadata.

### 3. Environment variables

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `DATA_DIR` | `/data` |
| `CORS_ORIGIN` | `https://verilock.online` (and any preview hosts) |
| `PUBLIC_APP_URL` | `https://verilock.online` (Stripe + absolute links) |
| `APP_PUBLIC_URL` | `https://verilock.online` (email deep links) |
| `NIMIQ_RPC_URL` | `https://rpc.nimiqwatch.com` |
| `NIM_MIN_CONFIRMATIONS` | `1` |
| `ATTESTATION_RECIPIENT` | Seal/credit sink address |
| `CREDITS_ENABLED` | `true` to enable prepaid credits |
| `CREDITS_STRIPE_ENABLED` | `true` when Stripe keys are set |
| `CREDITS_STRIPE_MARKUP` | `2` (card price = 2× live NIM market) |
| `CREDITS_MAX_PER_CHECKOUT` | e.g. `20` |
| `CREDITS_MAX_PER_NIM_TOPUP` | e.g. `50` |
| `SERVICE_WALLET_PRIVATE_KEY` | Hex key for credit-seal proofs (fund with dust NIM) |
| `STRIPE_SECRET_KEY` | Stripe secret (set when ready; rotate after) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret for `/api/stripe/webhook` |

**Stripe card credits:** mint happens on webhook `checkout.session.completed` **and** on return via `POST /api/credits/checkout/confirm` (success_url `?credits=success&session_id=…`). Also, `GET /api/credits/balance?syncStripe=1` re-checks pending sessions for the signed-in wallet (recovers missed webhooks).

In Stripe Dashboard → Developers → Webhooks, point events at:

`https://verilock.online/api/stripe/webhook`

Subscribe at least to: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`, `charge.dispute.created`. Put the signing secret in `STRIPE_WEBHOOK_SECRET`.

Do **not** set `SKIP_CHAIN_VERIFY` in production.

`PORT` is set automatically by Railway.

See root `.env.example` and `server/.env.example` for the full template.

### 4. Build & deploy

Railway reads `railway.toml` automatically. Default build packages the **journey UI** into `client/dist`:

```toml
buildCommand = npm install && … && npm run build --prefix client
startCommand = node --import tsx src/index.ts
healthcheckPath = /api/health
```

Or deploy via Docker:

```bash
docker build -t verilock .
docker run -p 3002:3002 -v verilock-data:/data -e DATA_DIR=/data -e NODE_ENV=production verilock
```

Production packaging details: [docs/service-b-journey.md](docs/service-b-journey.md).

### 5. Test production locally

```bash
npm run build
npm run start:prod-local
# → http://localhost:3003 (API + journey UI same origin; stop dev server if port conflicts)
```

### 6. Open in Nimiq Pay

```
nimiqpay://miniapp?url=https://your-app.up.railway.app
```

## On-chain payload

```
seal:v1:lock:{docId8}:{finalSha256}
```

Self-send transaction (`recipient = sender`, `value = 0`) — the locking wallet is the on-chain attestor.

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check (Railway) |
| POST | `/api/auth/challenge` | Wallet login challenge |
| POST | `/api/auth/verify` | Verify wallet signature |
| POST | `/api/documents` | Create document from SHA-256 fingerprint (no file upload) |
| GET | `/api/documents/:id` | Document detail |
| POST | `/api/documents/:id/signatures` | Sign document |
| POST | `/api/documents/:id/prepare-lock` | Set final hash |
| POST | `/api/documents/:id/attestations` | Submit lock tx |
| GET | `/api/documents/:id/certificate` | Verification certificate JSON |
| GET | `/api/verify/:slug` | Public verification |
| POST | `/api/verify/hash` | Lookup by SHA-256 |

## Competition checklist

- [x] Nimiq Pay mini app (`@nimiq/mini-app-sdk`)
- [x] NIM wallet interaction (`sign`, `sendBasicTransactionWithData`)
- [x] Railway deploy config (volume, health check, monolith)
- [x] Public GitHub repo with OSS license (MIT)
- [x] Live HTTPS demo on Railway — [https://verilock.online/](https://verilock.online/)
- [x] Nimiq wallet for prize payout — `NQ81 5N9J RGBJ MLJQ NBKE MQ1R D27T XS8P CVKA`