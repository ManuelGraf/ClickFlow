import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createFlow, getDb } from './db/db'
import { toStorageError, type StorageError } from './db/errors'
import { Library } from './components/Library'
import { Editor } from './components/Editor'
import { useToast } from './components/Toasts'
import { Logo } from './components/Logo'

// The only "routing": #/flow/<id> opens the editor, anything else is the
// library. Hash URLs keep reloads safe on static hosting (no 404 fallback
// needed on GitHub Pages) and let the browser's Back button return home.
type Route = { view: 'library' } | { view: 'editor'; flowId: string }

export function parseRoute(hash: string): Route {
  const match = /^#\/flow\/([\w-]{1,100})$/.exec(hash)
  return match ? { view: 'editor', flowId: match[1]! } : { view: 'library' }
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  const [db, setDb] = useState<'checking' | 'ready' | StorageError>('checking')
  const pendingFiles = useRef<{ flowId: string; files: File[] } | null>(null)
  const openedInSession = useRef(false)
  const toast = useToast()

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    // Seed files are consumed by the editor they were meant for.
    if (route.view === 'library') pendingFiles.current = null
  }, [route])

  useEffect(() => {
    getDb().then(
      () => setDb('ready'),
      (e: unknown) => setDb(toStorageError(e)),
    )
  }, [])

  const open = useCallback((flowId: string) => {
    openedInSession.current = true
    window.location.hash = `#/flow/${flowId}`
  }, [])

  const create = useCallback(
    async (files?: File[]) => {
      try {
        const flow = await createFlow()
        if (files?.length) pendingFiles.current = { flowId: flow.id, files }
        open(flow.id)
      } catch (e) {
        toast('error', toStorageError(e).message)
      }
    },
    [open, toast],
  )

  const exit = useCallback(() => {
    // Return along the history entry we came from, so Back/Forward stay tidy.
    if (openedInSession.current) {
      openedInSession.current = false
      window.history.back()
    } else {
      window.location.replace('#/')
    }
  }, [])

  if (db === 'checking') return null
  if (db !== 'ready') {
    return (
      <main className="fatal">
        <Logo size={40} />
        <h1>ClickFlow can’t store data in this browser</h1>
        <p>{db.message}</p>
        <p className="muted">
          Try a normal (non-private) window, or allow site data for this page. Nothing is ever sent
          to a server, so local storage is the only place your flows can live.
        </p>
      </main>
    )
  }

  if (route.view === 'editor') {
    const seed =
      pendingFiles.current?.flowId === route.flowId ? pendingFiles.current.files : undefined
    return <Editor key={route.flowId} flowId={route.flowId} initialFiles={seed} onExit={exit} />
  }
  return <Library onOpen={open} onCreate={(files) => void create(files)} />
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="fatal" role="alert">
        <Logo size={40} />
        <h1>Something went wrong</h1>
        <p>
          Your flows are safe — they are saved in this browser as you work. Reloading usually fixes
          this.
        </p>
        <pre className="fatal-detail">{this.state.error.message}</pre>
        <div className="button-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              window.location.hash = '#/'
              window.location.reload()
            }}
          >
            Go to all flows
          </button>
        </div>
      </main>
    )
  }
}
