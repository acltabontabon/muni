import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './styles.css'
import { App } from './App'
import { AuthProvider } from './lib/auth'
import { ToastProvider } from './ui'
import { applyTheme, readPrefs } from './lib/prefs'
import { initPwa } from './lib/pwa'

applyTheme(readPrefs().theme)
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(readPrefs().theme))
initPwa()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
