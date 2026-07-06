# VeriLock

PDF signer mini app for [Nimiq Pay](https://nimiq.com/nimiq-pay/) — sign agreements and anchor document SHA-256 hashes on the Nimiq blockchain.

Built for the [Mini Apps Competition](https://miniappscompetition.com/).

## What it does

1. **Fingerprint** a PDF locally (rental agreement, contract, etc.) — the file never leaves your device
2. **Share** the agreement link and send the same PDF to other signers out-of-band
3. **Sign** — each party verifies their PDF matches, then signs via Nimiq wallet
4. **Lock** — zero-fee Nimiq transaction anchors `seal:v1:lock:{docId}:{sha256}` on-chain
5. **Verify** — anyone can upload a PDF or enter a doc ID to check integrity

***REMOVED***

***REMOVED***
***REMOVED***
***REMOVED***
***REMOVED***
***REMOVED***
***REMOVED***
***REMOVED***

## GitHub

Repository: **https://github.com/sharms/verilock**

First-time setup (init git, create or rename the remote repo, push):

***REMOVED***
bash scripts/setup-github.sh
***REMOVED***

***REMOVED***

## Quick start (local)

**Requirements:** Node.js 22+

***REMOVED***
cd verilock
npm install
npm install --prefix server
npm install --prefix client

SKIP_CHAIN_VERIFY=true npm run dev
***REMOVED***

- **UI:** http://localhost:5174 (Vite dev server)
- **API:** http://localhost:3002/api/health

### Try in Nimiq Pay

1. Run `npm run dev` and note the **Network** URL (e.g. `http://192.168.1.42:5174`)
2. Open **Nimiq Pay** → **Mini Apps** → enter that URL
3. Connect wallet, upload a PDF, sign, and lock

## Deploy to Railway

VeriLock deploys as a **single service**: Express API + static client from one URL (ideal for mini apps — no CORS headaches).

### 1. Create project

***REMOVED***

***REMOVED***
***REMOVED***
***REMOVED***
***REMOVED***
***REMOVED***

***REMOVED***

***REMOVED***
***REMOVED***
***REMOVED***
***REMOVED***

### 2. Add a persistent volume

In the Railway dashboard:

1. Open your service → **Volumes** → **Add Volume**
2. Mount path: `/data`
3. Set environment variable: `DATA_DIR=/data`

This keeps SQLite (`seal.db`) across deploys. PDF files are not stored — only document fingerprints and signing metadata.

### 3. Environment variables

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `DATA_DIR` | `/data` |
| `CORS_ORIGIN` | `https://your-app.up.railway.app` |
| `NIMIQ_RPC_URL` | `https://rpc.nimiqwatch.com` |
| `NIM_MIN_CONFIRMATIONS` | `1` |

Do **not** set `SKIP_CHAIN_VERIFY` in production.

`PORT` is set automatically by Railway.

### 4. Build & deploy

Railway reads `railway.toml` automatically:

***REMOVED***toml
buildCommand = npm install && … && npm run build --prefix client
startCommand = NODE_ENV=production npm run start --prefix server
healthcheckPath = /api/health
***REMOVED***

Or deploy via Docker:

***REMOVED***
docker build -t verilock .
docker run -p 3002:3002 -v seal-data:/data -e DATA_DIR=/data -e NODE_ENV=production verilock
***REMOVED***

### 5. Test production locally

***REMOVED***
npm run build
npm run start:prod-local
# → http://localhost:3003 (API + UI same origin; stop dev server if port conflicts)
***REMOVED***

### 6. Open in Nimiq Pay

***REMOVED***
nimiqpay://miniapp?url=https://your-app.up.railway.app
***REMOVED***

## On-chain payload

***REMOVED***
seal:v1:lock:{docId8}:{finalSha256}
***REMOVED***

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
- [ ] Public GitHub repo with OSS license
- [ ] Live HTTPS demo on Railway
- [ ] Nimiq wallet for prize payout