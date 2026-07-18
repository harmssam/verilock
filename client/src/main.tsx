/**
 * Production UI entry — light shell + journey product flow.
 * Built via vite.config.ts → client/dist. See AGENTS.md.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
/* Journey product styles — light production theme (dark base archived) */
import './journey/Journey.css'
import { App } from './App'
/* Shell layout (header/home/footer) then page chrome (pricing/404) */
import './App.css'
import './shellPages.css'
import './landing/LandingHowItWorks.css'

const CHUNK_RELOAD_KEY = 'verilock-chunk-reload'

/** After deploy, a tab may still run old JS that imports removed hashed chunks (pdf-*.js). */
function isStaleChunkError(reason: unknown): boolean {
  const msg =
    reason instanceof Error
      ? reason.message
      : typeof reason === 'string'
        ? reason
        : String(reason ?? '')
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk [\d]+ failed|error loading dynamically imported module/i.test(
    msg,
  )
}

function reloadOnceForStaleAssets(): void {
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) return
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()))
  } catch {
    /* private mode */
  }
  window.location.reload()
}

// Vite fires this when a preloaded lazy chunk 404s after a deploy.
window.addEventListener('vite:preloadError', event => {
  event.preventDefault()
  reloadOnceForStaleAssets()
})

window.addEventListener('unhandledrejection', event => {
  if (!isStaleChunkError(event.reason)) return
  event.preventDefault()
  reloadOnceForStaleAssets()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
