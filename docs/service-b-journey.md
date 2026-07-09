# Service B — Journey UI as root SPA

Parallel Railway (or Docker) service that serves the **journey experiment UI** at `/`, without changing service A’s production build.

**No edge router** between A and B for now — each has its own public URL. Add a third reverse-proxy service later only if you need same-domain path split or % traffic.

## Live (Railway project `Verilock`)

| Service | URL | Notes |
|---------|-----|--------|
| **A** VeriLock | https://verilock.online | Prod SPA + SQLite volume `nimiq-seal-volume` |
| **B** VeriLock-Journey | https://verilock-journey-production.up.railway.app | Journey SPA + separate volume `verilock-journey-volume` |

Redeploy B from repo root (does not touch A):

```bash
railway up --service VeriLock-Journey --ci -y
```

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
| Config-as-code | `railway.service-b.toml` (optional dashboard path `/railway.service-b.toml`) |
| Service var | `RAILWAY_DOCKERFILE_PATH=Dockerfile.service-b` |
| Output | `client/dist/index.html` = journey shell (`data-verilock-surface="journey"`) |
| Vite config | `client/vite.journey.config.ts` (`base: '/'`, `outDir: dist-journey`) |
| Entry | `client/journey.html` → `src/experiment/main.tsx` → `ExperimentApp` |

### Railway override examples

**Option 1 — Dockerfile path (used in production for B)**

- Env: `RAILWAY_DOCKERFILE_PATH=Dockerfile.service-b`
- Or config file: `railway.service-b.toml` (`builder = "DOCKERFILE"`, `dockerfilePath = "Dockerfile.service-b"`)
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

- Journey UI uses the **same** Nimiq wallet + `/api/*` surface as service A (connect, create, sign, seal, verify-hash). Demo wallet/fingerprint paths are removed.
- Invite links are `/d/:slug` on the journey host (same SPA shell).
- Do **not** change service A’s default `npm run build` to journey packaging.
- Use a **separate volume** on Railway if service B should not share SQLite with production (B has its own documents DB).
