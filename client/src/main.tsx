/**
 * LEGACY entry — mounts App.tsx (pre-Journey). Production entry is
 * client/src/experiment/main.tsx via journey.html / vite.journey.config.ts.
 * See AGENTS.md.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)