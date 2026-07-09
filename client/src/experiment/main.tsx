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
