# Service B — Journey UI as root SPA

Parallel Railway (or Docker) service that serves the **journey experiment UI** at `/`, without changing service A’s production build.

## Service A (production — unchanged)

| Setting | Value |
|---------|--------|
| Build | `npm run build` (root) or Dockerfile default |
| Client | `npm run build --prefix client` → production `App` via `index.html` → `src/main.tsx` |
| Railway | Existing `railway.toml` / Dockerfile |

## Service B (journey)

| Setting | Value |
|---------|--------|
| Build (root) | `npm run build:service-b` |
| Client only | `npm run package:service-b --prefix client` |
| Docker | `Dockerfile.service-b` |
| Output | `client/dist/index.html` = journey shell (`data-verilock-surface="journey"`) |
| Vite config | `client/vite.journey.config.ts` (`base: '/'`, `outDir: dist-journey`) |
| Entry | `client/journey.html` → `src/experiment/main.tsx` → `ExperimentApp` |

### Railway override examples

**Option 1 — Dockerfile path**

- Dockerfile path: `Dockerfile.service-b`
- Start: same as A (`node --import tsx src/index.ts` from server)

**Option 2 — nixpacks build command**

```text
npm install && npm install --prefix server && npm install --prefix client && npm run package:service-b --prefix client
```

Start command (same as A):

```text
node --import tsx src/index.ts
```

(Working directory: `server`, as today.)

### Local verify

```bash
# Service A default still works
npm run build --prefix client
# → client/dist/index.html boots production

# Service B packaging
npm run package:service-b --prefix client
# → client/dist is journey

# Structural tests
npm run test:service-b --prefix client
VERIFY_DIST=1 npm run test:service-b --prefix client

# Serve journey via Express
npm run start:service-b-local
# → http://localhost:3004/
```

### Notes

- Journey UI may still be demo-state for wallet/API; packaging is independent of Nimiq wiring.
- Do **not** change service A’s default `npm run build` to journey packaging.
- Use a **separate volume** on Railway if service B should not share SQLite with production.
