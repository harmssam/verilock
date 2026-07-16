/**
 * Landing redesign preview entry.
 * Does not replace production Journey (`experiment/main.tsx`).
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
/* Reuse Journey component styles (AccountMenu, DocumentJourney, How it works, etc.) */
import '../experiment/ExperimentApp.css'
import { LandingRedesignApp } from './LandingRedesignApp'
import './LandingRedesign.css'
import './LandingHowItWorks.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LandingRedesignApp />
  </StrictMode>,
)
