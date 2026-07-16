# Navy Journey shell archive (2026-07-16)

Snapshot of the **production shell before the light redesign** became the sole frontend.

## What this was

| Piece | Role |
|-------|------|
| `ExperimentApp.tsx` + `.css` | Deep-navy product shell (header, path picker home, shell routes) |
| `main.tsx` | Journey entry with stale-chunk reload |
| `journey.html` | Production SEO HTML |
| `vite.journey.config.ts` | Production Vite config (`:5176`, `dist-journey`) |
| `landing-redesign.html` + `vite.landing-redesign.config.ts` | Parallel light-shell preview (`:5178`) before promotion |
| `legacy-*` | Pre-journey SPA root entry still living beside Journey |

## Current production

Light redesign shell + `client/src/journey/` product flow (DocumentJourney, etc.).

**Do not develop features here.** Restore only for historical comparison.
