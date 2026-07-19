# VeriLock journey product modules

**Production product flow** lives here (DocumentJourney, stage rail, dock, wallet/credits UI).

The **shell** (header, light home, shell routes) is `client/src/App.tsx` + `client/src/landing/`.

Served at `/` via default `npm run build` / `npm run dev`. See repo root **`AGENTS.md`**.

Before restyling: load **`docs/journey-anti-slop.md`** and **`PRODUCT.md`** (feature parity).

## Concept

| Idea | What you get |
|------|----------------|
| **Path-first** | Create / Invited / Verify — shell home picks intent, then focused action dock |
| **Document stage** | Visual document card that gains fingerprint, signatures, and a seal stamp |
| **One action at a time** | Controls live in the dock; stage rail shows progress |
| **Account chrome** | Connect, address, copy, disconnect (shell header + AccountMenu) |
| **Privacy always on** | Trust bar + per-step privacy note |
| **How it works** | Collapsible story (shell home + in-flow panel) |

## Run

```bash
npm run dev --prefix client
# → http://localhost:5176/
```

## Key files

```
client/src/journey/
  DocumentJourney.tsx      # main flow
  DocumentStage.tsx        # visual document metaphor
  AccountMenu.tsx
  LoginSheet.tsx
  StageRail.tsx
  Journey.css        # dock / stage styles (name historical)
  types.ts
```

## Production packaging

```bash
npm run build --prefix client               # → client/dist
npm run test:production --prefix client
```
