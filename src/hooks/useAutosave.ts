import { useCallback, useEffect, useRef, useState } from 'react'
import type { FlowDoc } from '../types'
import { saveFlowDoc } from '../db/db'
import { toStorageError, type StorageError } from '../db/errors'
import { trackWrite } from '../lib/pending'

export type SaveState =
  | { status: 'saved' }
  | { status: 'pending' }
  | { status: 'saving' }
  | { status: 'error'; error: StorageError }

export const AUTOSAVE_DELAY = 500

/**
 * Debounced autosave of the editor document. Saves are serialized: if the
 * document changes while a save is running, another save follows with the
 * newest state. `flush()` saves immediately and reports success.
 */
export function useAutosave(doc: FlowDoc | null, onSaved?: (doc: FlowDoc) => void) {
  const [state, setState] = useState<SaveState>({ status: 'saved' })
  const latest = useRef(doc)
  const saved = useRef<FlowDoc | null>(doc)
  const inflight = useRef<Promise<unknown> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const onSavedRef = useRef(onSaved)
  onSavedRef.current = onSaved

  const flush = useCallback(async (): Promise<boolean> => {
    clearTimeout(timer.current)
    if (inflight.current) await inflight.current.catch(() => undefined)
    const target = latest.current
    if (!target || target === saved.current) {
      setState((s) => (s.status === 'error' ? s : { status: 'saved' }))
      return true
    }
    setState({ status: 'saving' })
    const save = trackWrite(saveFlowDoc(target))
    inflight.current = save
    try {
      await save
      saved.current = target
    } catch (e) {
      setState({ status: 'error', error: toStorageError(e) })
      return false
    } finally {
      if (inflight.current === save) inflight.current = null
    }
    onSavedRef.current?.(target)
    if (latest.current !== target) return flush()
    setState({ status: 'saved' })
    return true
  }, [])

  /** Declare a document as already persisted (the one just loaded). */
  const markSaved = useCallback((d: FlowDoc) => {
    saved.current = d
    latest.current = d
  }, [])

  useEffect(() => {
    latest.current = doc
    if (!doc || doc === saved.current) return
    setState((s) => (s.status === 'saving' ? s : { status: 'pending' }))
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), AUTOSAVE_DELAY)
  }, [doc, flush])

  // Save right away when the tab is hidden or closed, and warn on close if a
  // save is still outstanding.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (latest.current && latest.current !== saved.current) {
        void flush()
        e.preventDefault()
      }
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('beforeunload', onBeforeUnload)
      clearTimeout(timer.current)
    }
  }, [flush])

  const isDirty = useCallback(() => latest.current !== saved.current, [])

  return { state, flush, markSaved, isDirty }
}
