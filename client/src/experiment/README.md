# VeriLock UI experiment - Document Journey

**This is production UI.** Served at `/` via default `npm run build` (journey packaging).

## Concept (v2)

Not a thinner clone of the production step list.

| Idea | What you get |
|------|----------------|
| **Path-first** | Create / Invited / Verify - pick intent, then a focused action dock |
| **Document stage** | Visual PDF card that gains fingerprint, signatures, and a seal stamp |
| **One action at a time** | Controls live in the dock; stage rail shows progress |
| **Account chrome** | Connect pill, full address, copy, disconnect / log out |
| **Privacy always on** | Expandable trust bar + per-step privacy note |
| **How it works** | Collapsible 6-beat story with privacy lines |
| **Drag & drop** | Hero PDF drop zones; multi-file hooks reserved |

## Run

```bash
cd client
./node_modules/.bin/vite --config vite.experiment.config.ts
```

Open **http://localhost:5175/experiment.html**

## Files

```
client/experiment.html
client/vite.experiment.config.ts
client/src/experiment/
  main.tsx
  ExperimentApp.tsx|css
  DocumentJourney.tsx      # main flow
  DocumentStage.tsx        # visual document metaphor
  AccountMenu.tsx
  PdfDropZone.tsx
  types.ts
  README.md
```

## Production packaging (journey as `/`)

See [docs/service-b-journey.md](../../../docs/service-b-journey.md).

```bash
npm run build --prefix client               # journey → client/dist (default)
npm run build:legacy --prefix client        # pre-journey App → client/dist
npm run dev --prefix client                 # journey at http://localhost:5176
```
