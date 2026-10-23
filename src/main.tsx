import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App, { ErrorBoundary } from './App'
import { ToastProvider } from './components/Toasts'
import { DialogProvider } from './components/Dialog'
import './app.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <DialogProvider>
          <App />
        </DialogProvider>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
)

// Offline support: the service worker (generated at build time, see
// build/offline.ts) caches the app's own static files — never user data.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // Offline support is optional; the app works without it.
    })
  })
}
