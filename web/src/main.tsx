import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './styles.css'
import './worlds/worlds.css'
import { App } from './App'
import { AuthProvider } from './lib/auth'
import { E2eeProvider } from './lib/e2ee/E2eeProvider'
import { ToastProvider } from './ui'
import { applyAppearance } from './lib/prefs'
import { initPwa } from './lib/pwa'

applyAppearance()
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyAppearance())
initPwa()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <E2eeProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </E2eeProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
