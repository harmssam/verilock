/**
 * PRODUCTION UI entry — Journey Edition (VeriLock default).
 * Built via vite.journey.config.ts → client/dist. See AGENTS.md.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { ExperimentApp } from './ExperimentApp'
import './ExperimentApp.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ExperimentApp />
  </StrictMode>,
)
