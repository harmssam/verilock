# Production UI — single SPA

**One production frontend.** Default `npm run build`, `Dockerfile`, and `railway.toml` package the light shell + journey product flow into `client/dist`.

The old dual-service names (`service-b`, `package:service-b`, `Dockerfile.service-b`) remain as **aliases** so existing Railway settings keep working.

## Live (Railway project `Verilock`)

| Service | URL | Notes |
|---------|-----|--------|
| **VeriLock-Journey** | https://verilock.online | Production — SPA + volume `verilock-journey-volume` |
| **VeriLock** (legacy host) | https://verilock-production.up.railway.app | Optional rollback; volume `nimiq-seal-volume` |

Redeploy production:

```bash
railway up --service VeriLock-Journey --ci -y
```

## Default production build

| Setting | Value |
|---------|--------|
| Build (root) | `npm run build` |
| Client only | `npm run build --prefix client` |
| Docker | `Dockerfile` (or alias `Dockerfile.service-b`) |
| Config-as-code | `railway.toml` (or alias `railway.service-b.toml`) |
| Output | `client/dist/index.html` = production shell (`data-verilock-surface="journey"`) |
| Vite config | `client/vite.config.ts` (`base: '/'`, `outDir: dist-journey` then copy → `dist`) |
| Entry | `client/index.html` → `src/main.tsx` → `App` |

### Layout

| Path | Role |
|------|------|
| `client/src/App.tsx` | Light shell (header, routes, home ↔ track blend) |
| `client/src/landing/` | Path cards, hero, how-it-works |
| `client/src/journey/` | DocumentJourney, login, seal, agreements UI |

### Local verify

```bash
npm run build --prefix client
# → client/dist/index.html boots production shell

npm run test:service-b --prefix client
VERIFY_DIST=1 npm run test:service-b --prefix client

npm run start:prod-local
# → http://localhost:3003/
```

### Archive (recovery only)

Snapshots under `client/src/archive/` (pre-journey SPA, navy shell, orphan components).  
**Do not** ship archive trees as production.

### Notes

- Same Nimiq wallet + `/api/*` surface (connect, create, sign, seal, verify-hash).
- Invite links are `/d/:slug` on the production host (same SPA shell).
- Production and any parallel Railway service should use **separate volumes** if they must not share SQLite.
