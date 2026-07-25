# Experiment / lab UIs

Parallel to production seal. Gated by `PDF_ANNOTATION_UI` / `FEATURES.pdfAnnotationUi`.

| Route | Component | Purpose |
|-------|-----------|---------|
| `/pdf` | `DocumentJourney.tsx` | Annotate, pack v1 stream, optional on-chain publish |
| `/pdf/lab` | `SignatureLab.tsx` | Signature encoding / frame-size estimates |
| `/pdf2` | `ArchiveLab.tsx` | **Hash-only archive demo**: 8-byte association id, multi-stream pack, service-wallet broadcast, reconstruct via `GET /api/chain-data/:sha?source=scan` |

## Local smoke test for `/pdf2`

```bash
# terminal 1 - API (from repo root)
export ANNOTATION_STREAM_BROADCAST=true
export SERVICE_WALLET_PRIVATE_KEY=<32-byte hex>   # funded, ≠ ATTESTATION_RECIPIENT
npm run dev   # or server + client separately

# browser
open http://localhost:5176/pdf2
```

1. Connect wallet (auth only — dust comes from service wallet)  
2. Drop a PDF → note association id (first 16 hex of fingerprint)  
3. Draw a signature  
4. **Pack locally** → frame counts  
5. **Publish to Nimiq** → tx list  
6. **Scan Nimiq (hash only)** → painted reconstruct  

No seal credits are charged.
