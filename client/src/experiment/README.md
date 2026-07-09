# VeriLock UI experiment — Document Journey

Parallel prototype. **Production files stay untouched.**

## Concept (v2)

Not a thinner clone of the production step list.

| Idea | What you get |
|------|----------------|
| **Path-first** | Create / Invited / Verify — pick intent, then a focused action dock |
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

## Promote later

Wire real wallet/API into `DocumentJourney` + replace production home/create split with this model.

## Service B packaging (journey as `/`)

See [docs/service-b-journey.md](../../../docs/service-b-journey.md).

```bash
npm run package:service-b --prefix client   # journey → client/dist
npm run build --prefix client               # production App → client/dist (service A)
```
