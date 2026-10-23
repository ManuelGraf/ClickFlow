import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { X } from 'lucide-react'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  className?: string
}

/**
 * Modal built on the native <dialog>: focus trapping, Escape to close, inert
 * background and focus return all come from the browser.
 */
export function Dialog({ open, onClose, title, children, footer, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      // showModal() focuses the first focusable element (the close button);
      // move focus to the intended control instead.
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    }
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className={`dialog ${className ?? ''}`}
      aria-labelledby={titleId}
      onClose={() => {
        // The native close event is async: when we close the dialog ourselves
        // (open=false) or it was already reopened, this event is stale.
        if (open && !ref.current?.open) onClose()
      }}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onMouseDown={(e) => {
        // Click on the backdrop (the dialog element itself, outside its box).
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {open && (
        <div className="dialog-body">
          <header className="dialog-header">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <X size={18} aria-hidden />
            </button>
          </header>
          <div className="dialog-content">{children}</div>
          {footer && <footer className="dialog-footer">{footer}</footer>}
        </div>
      )}
    </dialog>
  )
}

// ---------------------------------------------------------------- confirm / prompt

interface ConfirmOptions {
  title: string
  message: ReactNode
  confirmLabel: string
  danger?: boolean
}

interface PromptOptions {
  title: string
  label: string
  initial: string
  confirmLabel: string
}

type Request =
  | ({ kind: 'confirm'; resolve: (ok: boolean) => void } & ConfirmOptions)
  | ({ kind: 'prompt'; resolve: (value: string | null) => void } & PromptOptions)

interface DialogApi {
  confirm(options: ConfirmOptions): Promise<boolean>
  prompt(options: PromptOptions): Promise<string | null>
}

const DialogContext = createContext<DialogApi | null>(null)

export function useDialogs(): DialogApi {
  const api = useContext(DialogContext)
  if (!api) throw new Error('useDialogs outside DialogProvider')
  return api
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null)
  const [value, setValue] = useState('')

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setRequest({ kind: 'confirm', resolve, ...options })),
    [],
  )
  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        setValue(options.initial)
        setRequest({ kind: 'prompt', resolve, ...options })
      }),
    [],
  )
  const api = useRef<DialogApi>({ confirm, prompt }).current

  const close = (result: boolean) => {
    if (!request) return
    if (request.kind === 'confirm') request.resolve(result)
    else request.resolve(result && value.trim() ? value.trim() : null)
    setRequest(null)
  }

  return (
    <DialogContext.Provider value={api}>
      {children}
      <Dialog
        open={request !== null}
        onClose={() => close(false)}
        title={request?.title ?? ''}
        className="dialog-small"
        footer={
          request && (
            <>
              {/* Destructive confirmations focus Cancel, so Enter is safe. */}
              <button
                type="button"
                className="btn"
                onClick={() => close(false)}
                data-autofocus={(request.kind === 'confirm' && request.danger) || undefined}
              >
                Cancel
              </button>
              <button
                type="submit"
                form="dialog-form"
                className={`btn ${request.kind === 'confirm' && request.danger ? 'btn-danger' : 'btn-primary'}`}
                data-autofocus={(request.kind === 'confirm' && !request.danger) || undefined}
              >
                {request.confirmLabel}
              </button>
            </>
          )
        }
      >
        {request && (
          <form
            id="dialog-form"
            onSubmit={(e) => {
              e.preventDefault()
              close(true)
            }}
          >
            {request.kind === 'confirm' ? (
              <div className="dialog-message">{request.message}</div>
            ) : (
              <label className="field">
                <span className="field-label">{request.label}</span>
                <input
                  className="input"
                  value={value}
                  maxLength={200}
                  data-autofocus
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setValue(e.target.value)}
                />
              </label>
            )}
          </form>
        )}
      </Dialog>
    </DialogContext.Provider>
  )
}
