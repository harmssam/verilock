# PDF annotation lab — parallel to seal

The PDF overlay + Nimiq stream work is a **parallel product path**. It must not change seal behavior (wallet sign, credits, attestations, prepare-lock).

## Paths

| Surface | Role |
|---------|------|
| `/` … `/d/:slug`, seal, credits | **Active product** — DocumentJourney |
| `/pdf`, `/pdf/lab` | **Lab** — annotate, pack, on-chain stream, reconstruct |

No landing path card points at `/pdf` unless you add one later.

## Env flags

| Variable | Where | Meaning |
|----------|--------|---------|
| `PDF_ANNOTATION_UI` | Server runtime | `true` (default): SPA serves `/pdf` + stream APIs. `false`: 404 lab routes. |
| `ANNOTATION_STREAM_BROADCAST` | Server | Prod: must be `true` to multi-tx publish. |
| `SERVICE_WALLET_PRIVATE_KEY` | Server | Signs stream frames (and credit seals). |
| `VITE_PDF_ANNOTATION_UI` | Client build | Optional build-time default; runtime `/api/features` overrides. |

## Isolation rules

1. Do **not** import `experiment/*` or `annotationStream` into `journeySeal.ts` / seal flow.
2. Seal attestation payload stays **0x01 / 37 bytes**; streams use **0xA1 / 64-byte frames**.
3. Stream table is separate (`annotation_streams`); documents.annotations is optional JSON only.
4. Kill lab on production without code change: set `PDF_ANNOTATION_UI=false` and redeploy (or restart).

## Live testing without risking production deploys

**Option A — same site, lab URL only (current)**  
- Product: `https://verilock.online/`  
- Lab: `https://verilock.online/pdf` (noindex)  
- Seal path unchanged; only `/pdf` uses lab code.

**Option B — Railway staging environment (recommended for risky deploys)**  

```bash
railway environment new staging --duplicate production
# Deploy Journey service to staging; use the generated *.up.railway.app URL
# Production keeps stable; staging gets experimental commits first
```

Copy seal-critical vars to staging; use a **separate** funded service wallet if you do not want staging to share production service-wallet balance.

## Promote lab → product later

Only when ready: wire optional overlays into creator flow, keep stream publish post-seal, still behind flags.
