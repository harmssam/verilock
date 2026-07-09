# Pre-journey production archive (2026-07-09)

Snapshot of the production SPA shell before promoting the journey UI to `/`.

## Current production

Journey is the default build (`npm run build` → `client/dist` journey shell).  
This folder is a **recovery snapshot** only.

## Build legacy SPA without restoring files

```bash
npm run build:legacy --prefix client
# → client/dist from index.html → src/main.tsx → App
```

Local dev of the old UI:

```bash
npm run dev:legacy --prefix client
# → http://localhost:5174
```

## Full restore (overwrite live sources)

```bash
cp client/src/archive/pre-journey-2026-07-09/App.tsx client/src/App.tsx
cp client/src/archive/pre-journey-2026-07-09/App.css client/src/App.css
cp client/src/archive/pre-journey-2026-07-09/WorkflowGuide.tsx client/src/WorkflowGuide.tsx
cp client/src/archive/pre-journey-2026-07-09/WorkflowGuide.css client/src/WorkflowGuide.css
cp client/src/archive/pre-journey-2026-07-09/main.tsx client/src/main.tsx
# then: npm run build:legacy --prefix client  (or rewire default build)
```

Or: `git checkout <commit-before-promotion> -- client/src/App.tsx client/src/App.css ...`
