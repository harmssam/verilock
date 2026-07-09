# Production UI — Journey SPA

**Journey is production.** Default `npm run build`, `Dockerfile`, and `railway.toml` all package the journey UI into `client/dist`.

The old dual-service names (`service-b`, `package:service-b`, `Dockerfile.service-b`) remain as **aliases** so existing Railway settings keep working.

## Live (Railway project `Verilock`)

| Service | URL | Notes |
|---------|-----|--------|
| **VeriLock-Journey** | https://verilock.online | Production — journey SPA + volume `verilock-journey-volume` |
| **VeriLock** (legacy host) | https://verilock-production.up.railway.app | Optional rollback; volume `nimiq-seal-volume` |

Redeploy production (does not require special flags anymore):

```bash
# From repo root — same packaging whether you use Dockerfile or nixpacks
railway up --service VeriLock-Journey --ci -y
```

## Default production build

| Setting | Value |
|---------|--------|
| Build (root) | `npm run build` |
| Client only | `npm run build --prefix client` |
| Docker | `Dockerfile` (or alias `Dockerfile.service-b`) |
| Config-as-code | `railway.toml` (or alias `railway.service-b.toml`) |
| Output | `client/dist/index.html` = journey shell (`data-verilock-surface="journey"`) |
| Vite config | `client/vite.journey.config.ts` (`base: '/'`, `outDir: dist-journey` then copy → `dist`) |
| Entry | `client/journey.html` → `src/experiment/main.tsx` → `ExperimentApp` |

### Railway notes

- Services that still set `RAILWAY_DOCKERFILE_PATH=Dockerfile.service-b` are fine — that file matches production packaging.
- New services can use default `Dockerfile` / `railway.toml` only.
- Start command (unchanged): `node --import tsx src/index.ts` (working directory: `server`).

### Local verify

```bash
# Production (journey)
npm run build --prefix client
# → client/dist/index.html boots journey

# Structural tests
npm run test:service-b --prefix client
VERIFY_DIST=1 npm run test:service-b --prefix client

# Serve via Express
npm run start:prod-local
# → http://localhost:3003/
```

### Legacy SPA (pre-journey)

Still in the tree for recovery:

```bash
npm run build:legacy --prefix client
# → client/dist from index.html → src/main.tsx → App

npm run dev:legacy --prefix client
# → http://localhost:5174 (old Vite default)
```

Snapshot: `client/src/archive/pre-journey-2026-07-09/`.

### Notes

- Journey UI uses the same Nimiq wallet + `/api/*` surface (connect, create, sign, seal, verify-hash).
- Invite links are `/d/:slug` on the production host (same SPA shell).
- Production and any parallel Railway service should use **separate volumes** if they must not share SQLite.
