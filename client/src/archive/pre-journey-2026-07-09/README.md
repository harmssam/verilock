# Pre-journey production archive (2026-07-09)

Snapshot of the production SPA shell before promoting the journey UI to `/`.

## Restore

```bash
cp client/src/archive/pre-journey-2026-07-09/App.tsx client/src/App.tsx
cp client/src/archive/pre-journey-2026-07-09/App.css client/src/App.css
cp client/src/archive/pre-journey-2026-07-09/WorkflowGuide.tsx client/src/WorkflowGuide.tsx
cp client/src/archive/pre-journey-2026-07-09/WorkflowGuide.css client/src/WorkflowGuide.css
cp client/src/archive/pre-journey-2026-07-09/main.tsx client/src/main.tsx
# rebuild client and redeploy
```

Or: `git checkout <commit-before-promotion> -- client/src/App.tsx client/src/App.css ...`

Also tag: see git history around the "Archive pre-journey production" commit.
