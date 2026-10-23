import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'

type ToastKind = 'info' | 'success' | 'error'

interface Toast {
  id: number
  kind: ToastKind
  message: string
}

type ShowToast = (kind: ToastKind, message: string) => void

const ToastContext = createContext<ShowToast | null>(null)

export function useToast(): ShowToast {
  const show = useContext(ToastContext)
  if (!show) throw new Error('useToast outside ToastProvider')
  return show
}

const ICONS = { info: Info, success: CircleCheck, error: CircleAlert }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id))
  }, [])

  const show = useCallback<ShowToast>(
    (kind, message) => {
      const id = nextId.current++
      setToasts((ts) => [...ts.slice(-3), { id, kind, message }])
      setTimeout(() => dismiss(id), kind === 'error' ? 9000 : 4500)
    },
    [dismiss],
  )

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => {
          const Icon = ICONS[t.kind]
          return (
            <div
              key={t.id}
              className={`toast toast-${t.kind}`}
              role={t.kind === 'error' ? 'alert' : undefined}
            >
              <Icon size={18} aria-hidden className="toast-icon" />
              <span className="toast-message">{t.message}</span>
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                aria-label="Dismiss"
                onClick={() => dismiss(t.id)}
              >
                <X size={16} aria-hidden />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
