# VeriLock — agent / contributor instructions

## Production UI is Journey Edition (only)

**Default and only production frontend is the Journey SPA.**

| Role | Path / command | Notes |
|------|----------------|-------|
| **PRIMARY UI** | `client/src/experiment/` | Journey Edition — edit here for product UX |
| **PRIMARY entry** | `client/src/experiment/main.tsx` → `ExperimentApp` | Mounted via `client/journey.html` |
| **PRIMARY Vite config** | `client/vite.journey.config.ts` | Default `npm run dev` / `npm run build` |
| **PRIMARY production URL** | `https://verilock.online` | Packaged into `client/dist` as root SPA |
| **Shared libraries** | `client/src/*.ts(x)` except `App.tsx` / legacy-only panels | `nimiq.ts`, `api.ts`, `NimiqPayOpenPanel`, seal helpers, etc. — OK to change when Journey needs them |
| **LEGACY (do not extend)** | `client/src/App.tsx`, `client/src/main.tsx`, `client/index.html`, `client/vite.config.ts` | Pre-journey SPA — recovery / reference only |
| **ARCHIVE (read-only)** | `client/src/archive/` | Snapshot of pre-journey UI — do not “fix” or port features by editing the archive |

### Commands (always prefer these)

```bash
npm run dev                 # server + Journey (client :5176)
npm run dev --prefix client # Journey only
npm run build --prefix client
npm run test:service-b --prefix client
```

**Do not** use as the default work path:

```bash
npm run dev:legacy
npm run build:legacy
vite --config vite.config.ts          # legacy
vite --config vite.experiment.config.ts  # old experiment port (obsolete for day-to-day)
```

### When implementing UI features

1. **Start in** `client/src/experiment/` (`DocumentJourney.tsx`, `useJourneyWallet.ts`, `ExperimentApp.*`, etc.).
2. **Reuse** shared modules under `client/src/` (`nimiq.ts`, wallet helpers, seal, pricing) — do not reimplement in Journey.
3. **Never** restore or grow the legacy step-list UI in `App.tsx` unless the user **explicitly** asks to work on the pre-journey SPA.
4. **Never** treat `client/src/archive/` as the active product. Read it only as historical reference (e.g. Pay UX patterns).
5. Journey **flow / information architecture** (path picker, stage rail, action dock) stays unless the user asks to redesign it.
6. Server APIs live under `server/` — shared by Journey and legacy; API changes must not assume legacy UI.

### How to tell you are on Journey

- Files under `client/src/experiment/`
- Styles in `ExperimentApp.css` (not loading full legacy `App.css` as the shell)
- Dev URL from default config: port **5176** (or next free), `journey.html` / root rewrite
- Build script: `package-service-b.mjs` / `vite.journey.config.ts` → `client/dist`

### How to tell you are on legacy (stop unless asked)

- Editing `client/src/App.tsx` as the main screen shell
- `client/src/main.tsx` importing `./App.tsx`
- Port **5174** / `npm run dev:legacy`

### Shared vs legacy-only

Safe shared edits (Journey may depend on these):

- `client/src/nimiq.ts`, `api.ts`, `session.ts`, hub redirect helpers
- `NimiqPayOpenPanel.tsx`, seal pricing, PDF hash, ShareInviteCard (if Journey imports them)

Legacy-only (do not invest product work here without an explicit request):

- `App.tsx`, `WorkflowGuide`, legacy screen routing, legacy-only panels not imported by Journey

### Email / features

- Optional ready-to-seal email is gated by client `FEATURES.emailNotifyUi` and server Resend flags.
- Do not re-enable or redesign email in the legacy app by default.

### If the user says “the app” / “production” / “VeriLock UI”

Interpret as **Journey Edition** (`client/src/experiment/`), never the pre-journey SPA.
