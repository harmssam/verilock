/**
 * Production UI entry — light shell + journey product flow.
 * Built via vite.config.ts → client/dist. See AGENTS.md.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { restorePayReturnPathIfNeeded, savePayReturnPath } from './hubReturnPath'
import { isMobileDevice, isNimiqPayHost, launchNimiqPayMiniApp } from './nimiq'
import './index.css'
/* Journey product styles — light production theme (dark base archived) */
import './journey/Journey.css'
import { App } from './App'
/* Shell layout (header/home/footer) then page chrome (pricing/404) */
import './App.css'
import './shellPages.css'
import './landing/LandingHowItWorks.css'

/**
 * Email “Open in Nimiq Pay” uses HTTPS `?openPay=1` (email clients often block
 * nimiqpay://). Strip the flag, stash the invite path, then hand off to Pay.
 * Desktop: only strip the flag — do not leave a sticky localStorage return path.
 */
function handleOpenPayQueryParam(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (url.searchParams.get('openPay') !== '1') return
  url.searchParams.delete('openPay')
  const cleanPath = `${url.pathname}${url.search}${url.hash}`
  const cleanHref = url.toString()
  window.history.replaceState(window.history.state, '', cleanPath)
  // Already inside Pay WebView — just keep the clean invite URL.
  if (isNimiqPayHost()) return
  if (isMobileDevice()) {
    savePayReturnPath(cleanPath)
    launchNimiqPayMiniApp(cleanHref)
  }
}

// Before React mounts: restore invite path if Pay dropped us on `/`, and handle
// email Pay handoff (?openPay=1).
restorePayReturnPathIfNeeded()
handleOpenPayQueryParam()

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
