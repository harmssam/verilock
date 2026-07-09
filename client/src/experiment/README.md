# VeriLock UI experiment

Parallel interactive workflow prototype. **Production files are untouched.**

## Run

From `client/`:

```bash
npx vite --config vite.experiment.config.ts
```

Opens **http://localhost:5175/experiment.html** (port **5175** so it won’t clash with the main app on 5174).

Build (optional):

```bash
npx vite build --config vite.experiment.config.ts
# → client/dist-experiment/
```

## What’s new

| Idea | Implementation |
|------|----------------|
| Steps 1–6 are self-contained | Expandable timeline; each step embeds its actions (connect, PDF drop, share, sign, seal, verify) |
| Less static | Subtle expand/collapse, drop-zone highlight, step progress states |
| Drag and drop | `PdfDropZone` — PDF-first; `multiple` / `onFiles` ready for multi-file later |

Demo state only (no real wallet/API).

## Files

```
client/experiment.html
client/vite.experiment.config.ts
client/src/experiment/
  main.tsx
  ExperimentApp.tsx
  ExperimentApp.css
  InteractiveWorkflow.tsx
  InteractiveWorkflow.css
  PdfDropZone.tsx
  types.ts
  README.md
```

## Promote to production later

1. Port `InteractiveWorkflow` + `PdfDropZone` into the main app (replace `WorkflowGuide` home view + create tab split).
2. Wire real `connectNimiq`, `api.createDocument`, hash PDF, seal flow, etc.
3. Delete or keep this entry as a playground.

No changes to `App.tsx`, `WorkflowGuide.tsx`, or `vite.config.ts` are required for this sandbox.
