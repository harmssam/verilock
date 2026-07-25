# Placement construction + hashes-only packaging

Two-phase multi-party PDF signing: **arrange** (empty slots + named people) then **fill** (ink/text blobs on Nimiq).

## Phases

| Phase | Who | Mutable |
|-------|-----|---------|
| Construction | Creator | People, empty placement slots (drag/delete) |
| Signing | Each party | Fill content for *their* slots only |

After **Lock placements**, geometry and assignees are immutable. Fills append only.

## Product decisions

- Journey: Fingerprint → **Arrange** → Sign → Invite → Seal → Verify
- Name lines: signer types at fill time (creator places empty boxes)
- Broadcast: plan lock + each fill batch go on-chain when service wallet + stream broadcast are configured
- Server stores **hashes + structure** (planRoot, batch roots, blob ids); not PDF bytes
- Seal attestation stays **0x01 / 37B** (isolated from this stream)

## Wire version 2 (`0xA1`)

Same 64-byte frame layout as v1 annotation streams:

```
[0]     MAGIC 0xA1
[1]     VERSION 2
[2]     type: HEAD=1 | DATA=2 | END=3
[3]     seq
[4]     total frames
[5..8]  PDF SHA-256 prefix (4 B)
[9..63] body (55 B)
```

HEAD body: full 32B pdf hash + payloadLen u32 + batchIndex u16 + CRC32.

Payload is one **batch** JSON (`BatchWire`):

```json
{
  "v": 2,
  "bi": 0,
  "pr": "<prev batch root or 64 zeros>",
  "pl": "<plan root>",
  "people": [{ "i": 1, "n": "Tom", "w": "NQ…" }],
  "places": [{ "id": "...", "p": 1, "k": "s", "page": 0, "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.05 }],
  "blobs": [{ "id": "<32 hex>", "t": "ink", "d": { "epsilon": 1.5, "lineWidthRatio": 0.02, "strokes": [] } }],
  "fills": [{ "s": "<slot id>", "b": "<blob id>", "p": 1 }]
}
```

`w` is the optional pre-bound Nimiq wallet (no spaces, uppercase). Required for offline identity reconstruct when present.

### Version 3 — archive manifest

Paid **Store forever** appends a final multi-tx stream (`0xA1` version **3**) after placement/annotation frames:

```json
{
  "v": 3,
  "kind": "archive_manifest",
  "pdf": "<original sha256>",
  "pl": "<plan root optional>",
  "doc": "<document id>",
  "title": "…",
  "people": [{ "i": 1, "n": "Tom", "w": "NQ…" }],
  "sigs": [{ "i": 1, "w": "NQ…", "n": "Tom", "at": 1700000000000, "t": "drawn", "sha": "<client sha>" }]
}
```

Public discovery (no auth):

- `GET /api/chain-data/:sha256` → tx hash list + onChain flag  
- `GET /api/chain-data/:sha256/reconstruct?source=wire|chain` → unpacked batches + manifest  
- Creator: `GET /api/documents/:id/on-chain-data/recovery` → full recovery JSON for offline

### Dedup

`blob_id = sha256(canonical_payload).slice(0, 32)` (first 16 bytes).

When packing a fill batch, only emit BLOB entries not already known for this PDF. Same ink for two signature lines → **one BLOB, two FILLs**.

### Batch chain

- Batch 0: plan lock (`people` + `places`, usually empty blobs/fills)
- Batch n: `prevRoot = batchRoot(n-1)` where `batchRoot = sha256(canonical wire JSON)`
- Reconstruct: sort by `bi`, verify chain, merge places/blobs/fills, expand to paint annotations

## Modules

| Path | Role |
|------|------|
| `client/src/pdf/placements.ts` | Domain types, plan/blob hashes, fill batch builder |
| `client/src/pdf/placementStream.ts` | v2 pack/unpack/merge/expand |
| `client/src/pdf/annotationStream.ts` | v1 free-form stream (unchanged) |

## Tests

```bash
npm run test:placement --prefix client
# or: node client/scripts/test-placement-stream.mjs
```

Lab: `/pdf` → **Pack plan + fill (dedup demo)** (client-only packer).

Production: **Arrange** step → `PlacementEditor` → **Lock placements** → `POST /api/placement-plans` with structure + `planRoot` + batch0 frames (hashes / wire cache; no PDF, no ink).
