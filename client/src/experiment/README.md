# Experiment: PDF annotations (no pdf-lib)

Local-only PDF overlays stored as JSON on the document record.

## Flow

1. User selects a PDF → rendered with **pdf.js** (never uploaded).
2. User draws a signature / places text → **normalized coordinates** + image/text payload.
3. `POST /api/documents` with `originalSha256` + `annotations` only (no PDF bytes).
4. On verify: re-open the original file locally, fetch annotations from the API, reconstruct via canvas overlay.
5. **Placement v2 (lab):** client packer for construction plan + fill batches with content-addressed blob dedup (`placements.ts` / `placementStream.ts`). See `docs/placement-construction.md`.

## Modules

| Path | Role |
|------|------|
| `client/src/pdf/annotations.ts` | Types + coordinate transform |
| `client/src/pdf/pdfDocument.ts` | pdf.js load/render helpers |
| `client/src/pdf/PdfAnnotator.tsx` | Place signature/text on pages |
| `client/src/pdf/PdfReconstructor.tsx` | Overlay annotations for verify |
| `client/src/experiment/DocumentJourney.tsx` | Create + verify experiment UI |

## Wiring

Mounted in the production shell (noindex):

| URL | UI |
|-----|-----|
| `/pdf` | Annotate PDF + create/verify |
| `/pdf/lab` | **Signature encoding lab** — draw, RDP simplify, compare PNG vs path sizes / ~Nimiq frames |

```text
http://localhost:5176/pdf
http://localhost:5176/pdf/lab
```

## Server

- `documents.annotations` TEXT column (nullable JSON) — legacy docs stay `NULL`.
- `publicDocument()` returns `annotations`.
- Create route rejects accidental PDF byte fields.
- Annotation streams (`POST /api/annotation-streams`): owner-scoped, max 32 frames, optional on-chain broadcast (`ANNOTATION_STREAM_BROADCAST` + service wallet).
- Reconstruct: `GET /api/annotation-streams/:sha256/reconstruct?fallback=index|none`.

## Coordinate system

Normalized fractions of page size, **top-left origin** (CSS-like):

- `x`, `y`, `width`, `height` ∈ [0, 1]
- Independent of zoom / devicePixelRatio when reconstructing
