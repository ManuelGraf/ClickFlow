import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Check,
  Circle,
  CircleAlert,
  CircleDot,
  Download,
  Hash,
  ImagePlus,
  LoaderCircle,
  Maximize,
  MousePointer2,
  PanelRightClose,
  PanelRightOpen,
  Redo2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type {
  Annotation,
  AnnotationColor,
  BlobRecord,
  ExportSettings,
  FlowDoc,
  Step,
} from '../types'
import { loadFlowDoc, putBlobs, setFlowThumbnail } from '../db/db'
import { StorageError, toStorageError } from '../db/errors'
import { ProjectFileError } from '../db/projectFile'
import {
  addAnnotation,
  addSteps,
  duplicateStep,
  moveStep,
  removeAnnotation,
  removeStep,
  setCardWidth,
  setFlowTitle,
  updateAnnotation,
  updateStep,
} from '../lib/flowOps'
import { moveBox, nextNumber } from '../lib/geometry'
import { commit, createHistory, redo, undo, type History } from '../lib/history'
import { newId } from '../lib/ids'
import { ACCEPT_ATTR, ImageImportError, prepareImage, imageFilesFrom } from '../lib/images'
import { computeLayout, LAYOUT, slotAt } from '../lib/layout'
import { trackWrite } from '../lib/pending'
import { exportProjectFile } from '../lib/projectIO'
import { renderThumbnail } from '../lib/exportFlow'
import { useAutosave, type SaveState } from '../hooks/useAutosave'
import { usePanZoom } from '../hooks/usePanZoom'
import { useDialogs } from './Dialog'
import { useToast } from './Toasts'
import { FlowCanvas } from './FlowCanvas'
import { ColorSwatches, Inspector } from './Inspector'
import { ExportDialog } from './ExportDialog'
import { MOD, ShortcutsDialog } from './ShortcutsDialog'
import type { ReorderPhase } from './StepCard'
import type { Selection, Tool, ToolState } from './editorTypes'

interface EditorProps {
  flowId: string
  /** Screenshots dropped on the library to start this flow. */
  initialFiles?: File[]
  onExit: () => void
}

type Load =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready' }

const NO_SELECTION: Selection = { stepId: null, annotationId: null }

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true
  return (
    target instanceof HTMLInputElement &&
    !['button', 'checkbox', 'radio', 'range'].includes(target.type)
  )
}

function isInteractive(target: EventTarget | null): boolean {
  return (
    isTextField(target) ||
    target instanceof HTMLButtonElement ||
    target instanceof HTMLSelectElement
  )
}

/** Keep the current export settings when undoing — they are preferences, not edits. */
function keepExport(prev: History<FlowDoc>, next: History<FlowDoc>): History<FlowDoc> {
  if (next === prev || next.present.flow.export === prev.present.flow.export) return next
  return {
    ...next,
    present: { ...next.present, flow: { ...next.present.flow, export: prev.present.flow.export } },
  }
}

/** Inputs that determine the thumbnail; regenerate only when they change. */
const thumbKey = (d: FlowDoc) => [d.flow.canvas.cardWidth, ...d.steps.slice(0, 3)]
const sameKey = (a: unknown[] | null, b: unknown[]) =>
  !!a && a.length === b.length && a.every((v, i) => v === b[i])

export function Editor({ flowId, initialFiles, onExit }: EditorProps) {
  const toast = useToast()
  const dialogs = useDialogs()
  const [history, setHistory] = useState<History<FlowDoc> | null>(null)
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [selection, setSelection] = useState<Selection>(NO_SELECTION)
  const [tools, setTools] = useState<ToolState>({ tool: 'select', color: 'red', numbered: false })
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth >= 1100)
  const [exportOpen, setExportOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null)
  const [reorder, setReorder] = useState<{ index: number; dx: number; dy: number } | null>(null)
  const [spacePan, setSpacePan] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const clipboard = useRef<Annotation | null>(null)
  const pendingReveal = useRef<string | null>(null)
  const pz = usePanZoom(viewportRef)

  const doc = history?.present ?? null
  const docRef = useRef(doc)
  docRef.current = doc
  const selectionRef = useRef(selection)
  selectionRef.current = selection

  // ------------------------------------------------------------ persistence

  const thumbDone = useRef<unknown[] | null>(null)
  const thumbTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const updateThumbnail = useCallback(async (d: FlowDoc) => {
    const key = thumbKey(d)
    if (sameKey(thumbDone.current, key)) return
    thumbDone.current = key
    try {
      const blob = await renderThumbnail(d)
      if (blob) await setFlowThumbnail(d.flow.id, blob)
    } catch {
      thumbDone.current = null // a thumbnail is a nicety; try again next time
    }
  }, [])

  const autosave = useAutosave(doc, (saved) => {
    clearTimeout(thumbTimer.current)
    thumbTimer.current = setTimeout(() => void trackWrite(updateThumbnail(saved)), 1500)
  })
  const { flush, markSaved } = autosave

  useEffect(() => {
    let active = true
    loadFlowDoc(flowId)
      .then((d) => {
        if (!active) return
        if (!d) return setLoad({ status: 'missing' })
        markSaved(d)
        if (d.flow.thumbnailBlobId) thumbDone.current = thumbKey(d)
        setHistory(createHistory(d))
        setLoad({ status: 'ready' })
      })
      .catch(
        (e: unknown) => active && setLoad({ status: 'error', message: toStorageError(e).message }),
      )
    return () => {
      active = false
    }
  }, [flowId, markSaved])

  // Leaving the editor (Back, browser back, closing): save and refresh the
  // thumbnail. Tracked so the library waits for it before listing.
  useEffect(
    () => () => {
      clearTimeout(thumbTimer.current)
      void trackWrite(
        flush().then(() => {
          const d = docRef.current
          return d ? updateThumbnail(d) : undefined
        }),
      )
    },
    [flush, updateThumbnail],
  )

  // ------------------------------------------------------------ editing

  const apply = useCallback((fn: (d: FlowDoc) => FlowDoc, coalesceKey?: string) => {
    setHistory((h) => (h ? commit(h, fn(h.present), { coalesceKey }) : h))
  }, [])

  const layout = useMemo(
    () => computeLayout(doc?.steps ?? [], doc?.flow.canvas.cardWidth ?? 640),
    [doc?.steps, doc?.flow.canvas.cardWidth],
  )
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  const stepIndex =
    doc && selection.stepId ? doc.steps.findIndex((s) => s.id === selection.stepId) : -1
  const step = stepIndex >= 0 ? doc!.steps[stepIndex]! : null
  const annotation = step?.annotations.find((a) => a.id === selection.annotationId) ?? null

  const revealStep = useCallback(
    (index: number) => {
      const card = layoutRef.current.cards[index]
      if (card)
        pz.reveal({
          x: card.x,
          y: card.labelY,
          width: card.width,
          height: card.height + LAYOUT.labelHeight,
        })
    },
    [pz],
  )

  useEffect(() => {
    const id = pendingReveal.current
    if (!id || !doc) return
    pendingReveal.current = null
    const index = doc.steps.findIndex((s) => s.id === id)
    if (index >= 0) revealStep(index)
  }, [doc, revealStep])

  const importFiles = useCallback(
    async (files: File[], slot?: number) => {
      if (!docRef.current || files.length === 0) return
      const ordered =
        files.length > 1
          ? [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
          : files
      const steps: Step[] = []
      const skipped: string[] = []
      let downscaled = 0
      let storageError: StorageError | null = null
      setImporting({ done: 0, total: ordered.length })
      for (const [i, file] of ordered.entries()) {
        try {
          const image = await prepareImage(file, file.name || 'Pasted image')
          const record: BlobRecord = {
            id: newId(),
            mimeType: image.mimeType,
            blob: image.blob,
            createdAt: Date.now(),
          }
          await putBlobs([record])
          steps.push({
            id: newId(),
            flowId,
            screenshotBlobId: record.id,
            order: 0,
            title: '',
            description: '',
            imageWidth: image.width,
            imageHeight: image.height,
            annotations: [],
          })
          if (image.downscaled) downscaled++
        } catch (e) {
          if (e instanceof ImageImportError) {
            skipped.push(e.message)
          } else {
            storageError = toStorageError(e)
            break
          }
        }
        setImporting({ done: i + 1, total: ordered.length })
      }
      setImporting(null)

      if (steps.length > 0) {
        const current = docRef.current!
        const selected = current.steps.findIndex((s) => s.id === selectionRef.current.stepId)
        const at = slot ?? (selected >= 0 ? selected + 1 : current.steps.length)
        apply((d) => addSteps(d, steps, at))
        setSelection({ stepId: steps[0]!.id, annotationId: null })
        pendingReveal.current = steps[0]!.id
      }
      if (storageError) toast('error', storageError.message)
      if (skipped.length > 0) {
        toast(
          'error',
          skipped.length === 1
            ? skipped[0]!
            : `${skipped.length} files were skipped: ${skipped[0]}`,
        )
      }
      if (downscaled > 0) {
        toast(
          'info',
          `${downscaled} large screenshot${downscaled === 1 ? ' was' : 's were'} scaled down to save browser storage.`,
        )
      }
    },
    [apply, flowId, toast],
  )

  // Screenshots handed over from the library's drop/paste.
  const seeded = useRef(false)
  useEffect(() => {
    if (load.status !== 'ready' || seeded.current || !initialFiles?.length) return
    seeded.current = true
    void importFiles(initialFiles)
  }, [load.status, initialFiles, importFiles])

  // First view: fit the flow if it stays readable, otherwise show its start.
  const fitted = useRef(false)
  const fitAll = useCallback(() => {
    const l = layoutRef.current
    pz.fit({ x: 0, y: 0, width: l.width, height: l.cardsBottom + LAYOUT.pad }, 1)
  }, [pz])
  useLayoutEffect(() => {
    if (load.status !== 'ready' || fitted.current || !viewportRef.current) return
    fitted.current = true
    const l = layoutRef.current
    const el = viewportRef.current
    const fitZoom = Math.min(
      (el.clientWidth - 64) / l.width,
      (el.clientHeight - 64) / (l.cardsBottom + LAYOUT.pad),
      1,
    )
    if (fitZoom >= 0.35) fitAll()
    else pz.setView({ zoom: 0.5, x: 16, y: 16 })
  }, [load.status, fitAll, pz])

  // ------------------------------------------------------------ step callbacks (stable)

  const onSelectStep = useCallback((stepId: string) => {
    setSelection((s) =>
      s.stepId === stepId && s.annotationId === null ? s : { stepId, annotationId: null },
    )
  }, [])
  const onSelectAnnotation = useCallback((stepId: string, annotationId: string | null) => {
    setSelection((s) =>
      s.stepId === stepId && s.annotationId === annotationId ? s : { stepId, annotationId },
    )
  }, [])
  const onCreateAnnotation = useCallback(
    (stepId: string, a: Annotation) => {
      apply((d) => addAnnotation(d, stepId, a))
      setSelection({ stepId, annotationId: a.id })
    },
    [apply],
  )
  const onChangeAnnotation = useCallback(
    (stepId: string, annotationId: string, box: { x: number; y: number; w: number; h: number }) =>
      apply((d) => updateAnnotation(d, stepId, annotationId, box)),
    [apply],
  )
  const onTitle = useCallback(
    (stepId: string, title: string) =>
      apply((d) => updateStep(d, stepId, { title }), `title:${stepId}`),
    [apply],
  )
  const onDescription = useCallback(
    (stepId: string, description: string) =>
      apply((d) => updateStep(d, stepId, { description }), `desc:${stepId}`),
    [apply],
  )
  const onReorder = useCallback(
    (index: number, phase: ReorderPhase, dx: number, dy: number) => {
      if (phase === 'move') return setReorder({ index, dx, dy })
      setReorder(null)
      if (phase === 'cancel') return
      const card = layoutRef.current.cards[index]
      if (!card) return
      const slot = slotAt(
        layoutRef.current.cards,
        card.x + card.width / 2 + dx / pz.viewRef.current.zoom,
      )
      apply((d) => moveStep(d, index, slot))
    },
    [apply, pz.viewRef],
  )

  // ------------------------------------------------------------ commands

  const doUndo = useCallback(() => setHistory((h) => (h ? keepExport(h, undo(h)) : h)), [])
  const doRedo = useCallback(() => setHistory((h) => (h ? keepExport(h, redo(h)) : h)), [])

  const setExportSettings = useCallback((settings: ExportSettings) => {
    setHistory((h) =>
      h ? { ...h, present: { ...h.present, flow: { ...h.present.flow, export: settings } } } : h,
    )
  }, [])

  const deleteStep = () => {
    const d = docRef.current
    if (!d || !step) return
    const neighbour = d.steps[stepIndex + 1] ?? d.steps[stepIndex - 1] ?? null
    apply((x) => removeStep(x, step.id))
    setSelection({ stepId: neighbour?.id ?? null, annotationId: null })
  }

  const deleteSelection = () => {
    if (step && annotation) {
      apply((x) => removeAnnotation(x, step.id, annotation.id))
      setSelection({ stepId: step.id, annotationId: null })
    } else {
      deleteStep()
    }
  }

  const duplicateStepNow = () => {
    const d = docRef.current
    if (!d || !step) return
    const result = duplicateStep(d, step.id)
    if (!result) return
    apply(() => result.doc)
    setSelection({ stepId: result.stepId, annotationId: null })
    pendingReveal.current = result.stepId
  }

  const duplicateSelection = () => {
    if (!step) return
    if (annotation) {
      const copy: Annotation = {
        ...moveBox(annotation, 0.02, 0.02),
        id: newId(),
        type: annotation.type,
        color: annotation.color,
        ...(annotation.number !== undefined ? { number: nextNumber(step.annotations) } : {}),
      }
      onCreateAnnotation(step.id, copy)
      return
    }
    duplicateStepNow()
  }

  const moveSelectedStep = (delta: -1 | 1) => {
    if (stepIndex < 0) return
    apply((d) => moveStep(d, stepIndex, delta > 0 ? stepIndex + 2 : stepIndex - 1))
    pendingReveal.current = step?.id ?? null
  }

  const selectAdjacent = (delta: -1 | 1) => {
    const d = docRef.current
    if (!d || d.steps.length === 0) return
    const index = stepIndex < 0 ? (delta > 0 ? 0 : d.steps.length - 1) : stepIndex + delta
    const target = d.steps[Math.max(0, Math.min(d.steps.length - 1, index))]!
    setSelection({ stepId: target.id, annotationId: null })
    revealStep(d.steps.indexOf(target))
  }

  const setColor = (color: AnnotationColor) => {
    setTools((t) => ({ ...t, color }))
    if (step && annotation) apply((d) => updateAnnotation(d, step.id, annotation.id, { color }))
  }

  const toggleNumber = () => {
    if (step && annotation?.type === 'ellipse') {
      const number =
        annotation.number === undefined
          ? nextNumber(step.annotations.filter((a) => a.id !== annotation.id))
          : undefined
      apply((d) => updateAnnotation(d, step.id, annotation.id, { number }))
    } else {
      setTools((t) => ({ ...t, numbered: !t.numbered }))
    }
  }

  const setTool = (tool: Tool) => setTools((t) => (t.tool === tool ? t : { ...t, tool }))

  const nudge = (dx: number, dy: number) => {
    if (!step || !annotation || !doc) return
    const card = layout.cards[stepIndex]!
    const box = moveBox(annotation, dx / card.width, dy / card.imageHeight)
    apply((d) => updateAnnotation(d, step.id, annotation.id, box), `nudge:${annotation.id}`)
  }

  const pasteAnnotation = () => {
    const source = clipboard.current
    if (!source || !step) return
    onCreateAnnotation(step.id, {
      ...source,
      id: newId(),
      ...(source.number !== undefined ? { number: nextNumber(step.annotations) } : {}),
    })
  }

  const exportProject = async () => {
    if (!doc) return
    await flush()
    try {
      await exportProjectFile(doc.flow)
    } catch (e) {
      toast('error', e instanceof ProjectFileError ? e.message : toStorageError(e).message)
    }
  }

  const exit = async () => {
    const ok = await flush()
    if (!ok) {
      const leave = await dialogs.confirm({
        title: 'Leave without saving?',
        message: <p>The latest changes could not be saved to browser storage and will be lost.</p>,
        confirmLabel: 'Leave anyway',
        danger: true,
      })
      if (!leave) return
    }
    onExit()
  }

  // ------------------------------------------------------------ keyboard & clipboard

  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {})
  keyHandler.current = (e: KeyboardEvent) => {
    if (!doc || document.querySelector('dialog[open]')) return
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()

    if (mod && key === 's') {
      e.preventDefault()
      void flush()
      return
    }
    if (mod && key === 'e') {
      e.preventDefault()
      setExportOpen(true)
      return
    }
    if (isTextField(e.target)) {
      if (e.key === 'Escape') (e.target as HTMLElement).blur()
      return
    }
    if (mod && key === 'z') {
      e.preventDefault()
      if (e.shiftKey) doRedo()
      else doUndo()
      return
    }
    if (mod && key === 'y') {
      e.preventDefault()
      doRedo()
      return
    }
    if (mod && key === 'd') {
      e.preventDefault()
      duplicateSelection()
      return
    }
    if (mod && key === 'c' && annotation) {
      clipboard.current = annotation
      toast('info', 'Highlight copied. Select another step and paste.')
      return
    }
    if (mod || (e.altKey && !e.key.startsWith('Arrow'))) return

    switch (e.key) {
      case 'Delete':
      case 'Backspace':
        e.preventDefault()
        deleteSelection()
        return
      case 'Escape':
        if (tools.tool !== 'select') setTool('select')
        else if (selection.annotationId)
          setSelection({ stepId: selection.stepId, annotationId: null })
        else setSelection(NO_SELECTION)
        return
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        e.preventDefault()
        const amount = e.shiftKey ? 10 : 1
        const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
          e.key
        ]!
        if (annotation) nudge(dir[0]! * amount, dir[1]! * amount)
        else if (e.altKey && dir[0] !== 0) moveSelectedStep(dir[0] as -1 | 1)
        else if (dir[0] !== 0) selectAdjacent(dir[0] as -1 | 1)
        return
      }
      case '+':
      case '=':
        pz.zoomBy(1.25)
        return
      case '-':
      case '_':
        pz.zoomBy(0.8)
        return
      case '0':
        pz.zoomTo(1)
        return
      case '?':
        setShortcutsOpen(true)
        return
    }
    if (e.shiftKey && e.code === 'Digit1') {
      fitAll()
      return
    }
    if (e.shiftKey) return
    switch (key) {
      case 'v':
        setTool('select')
        return
      case 'e':
        setTool('ellipse')
        return
      case 'm':
        setTool('marker')
        return
      case 'n':
        toggleNumber()
        return
      case '1':
      case '2':
      case '3':
      case '4':
        setColor((['red', 'orange', 'blue', 'green'] as const)[Number(key) - 1]!)
        return
    }
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ' && !isInteractive(e.target) && !document.querySelector('dialog[open]')) {
        e.preventDefault()
        setSpacePan(true)
        return
      }
      keyHandler.current(e)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpacePan(false)
    }
    const onBlur = () => setSpacePan(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  const pasteHandler = useRef<(e: ClipboardEvent) => void>(() => {})
  pasteHandler.current = (e: ClipboardEvent) => {
    if (!doc || document.querySelector('dialog[open]')) return
    const files = imageFilesFrom(e.clipboardData)
    if (files.length > 0) {
      e.preventDefault()
      void importFiles(files)
      return
    }
    if (!isTextField(e.target) && clipboard.current && step) {
      e.preventDefault()
      pasteAnnotation()
    }
  }
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => pasteHandler.current(e)
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  // ------------------------------------------------------------ render

  if (load.status !== 'ready' || !doc || !history) {
    return (
      <div className="editor-state">
        {load.status === 'loading' && (
          <p className="muted" aria-busy="true">
            Opening flow…
          </p>
        )}
        {load.status === 'missing' && <p>This flow no longer exists in this browser.</p>}
        {load.status === 'error' && (
          <p className="notice notice-error" role="alert">
            {load.message}
          </p>
        )}
        {load.status !== 'loading' && (
          <button type="button" className="btn" onClick={onExit}>
            <ArrowLeft size={16} aria-hidden /> Back to all flows
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="editor" data-inspector={inspectorOpen || undefined}>
      <header className="topbar editor-topbar">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void exit()}
          title="All flows"
        >
          <ArrowLeft size={16} aria-hidden /> <span className="hide-narrow">Flows</span>
        </button>
        <input
          className="title-input"
          value={doc.flow.title}
          aria-label="Flow title"
          maxLength={200}
          onChange={(e) => apply((d) => setFlowTitle(d, e.target.value), 'flow-title')}
          onBlur={(e) => {
            if (!e.target.value.trim()) apply((d) => setFlowTitle(d, 'Untitled flow'))
          }}
        />
        <SaveStatus state={autosave.state} onRetry={() => void flush()} />
        <div className="topbar-spacer" />
        <div className="btn-group" role="group" aria-label="History">
          <button
            type="button"
            className="icon-btn"
            onClick={doUndo}
            disabled={history.past.length === 0}
            aria-label="Undo"
            title={`Undo (${MOD}+Z)`}
          >
            <Undo2 size={18} aria-hidden />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={doRedo}
            disabled={history.future.length === 0}
            aria-label="Redo"
            title={`Redo (${MOD}+Shift+Z)`}
          >
            <Redo2 size={18} aria-hidden />
          </button>
        </div>
        <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
          <ImagePlus size={16} aria-hidden /> <span className="hide-narrow">Add screenshots</span>
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setExportOpen(true)}
          title={`Export PNG (${MOD}+E)`}
        >
          <Download size={16} aria-hidden /> Export
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setInspectorOpen((o) => !o)}
          aria-label={inspectorOpen ? 'Hide side panel' : 'Show side panel'}
          aria-pressed={inspectorOpen}
          title={inspectorOpen ? 'Hide side panel' : 'Show side panel'}
        >
          {inspectorOpen ? (
            <PanelRightClose size={18} aria-hidden />
          ) : (
            <PanelRightOpen size={18} aria-hidden />
          )}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT_ATTR}
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = ''
            void importFiles(files)
          }}
        />
      </header>

      <div className="editor-body">
        <div className="canvas-area">
          <FlowCanvas
            doc={doc}
            layout={layout}
            view={pz.view}
            viewportRef={viewportRef}
            selection={selection}
            tools={tools}
            spacePan={spacePan}
            reorder={reorder}
            onPan={pz.panBy}
            onBackgroundClick={() => setSelection(NO_SELECTION)}
            onDropFiles={(files, slot) => void importFiles(files, slot)}
            onPickFiles={() => fileInput.current?.click()}
            onSelectStep={onSelectStep}
            onSelectAnnotation={onSelectAnnotation}
            onCreateAnnotation={onCreateAnnotation}
            onChangeAnnotation={onChangeAnnotation}
            onTitle={onTitle}
            onDescription={onDescription}
            onReorder={onReorder}
          />

          <div className="toolbar" role="toolbar" aria-label="Highlight tools">
            <ToolButton
              tool="select"
              current={tools.tool}
              onSelect={setTool}
              label="Select"
              shortcut="V"
            >
              <MousePointer2 size={18} aria-hidden />
            </ToolButton>
            <ToolButton
              tool="ellipse"
              current={tools.tool}
              onSelect={setTool}
              label="Ellipse highlight"
              shortcut="E"
            >
              <Circle size={18} aria-hidden />
            </ToolButton>
            <ToolButton
              tool="marker"
              current={tools.tool}
              onSelect={setTool}
              label="Numbered marker"
              shortcut="M"
            >
              <CircleDot size={18} aria-hidden />
            </ToolButton>
            <span className="toolbar-sep" aria-hidden />
            <ColorSwatches
              value={annotation?.color ?? tools.color}
              onChange={setColor}
              label="Highlight color"
            />
            <span className="toolbar-sep" aria-hidden />
            <button
              type="button"
              className="icon-btn"
              aria-pressed={
                annotation?.type === 'ellipse' ? annotation.number !== undefined : tools.numbered
              }
              aria-label="Numbered ellipses"
              title="Add number badges to ellipses (N)"
              onClick={toggleNumber}
            >
              <Hash size={18} aria-hidden />
            </button>
          </div>

          <div className="zoombar" role="group" aria-label="Zoom">
            <button
              type="button"
              className="icon-btn"
              onClick={() => pz.zoomBy(0.8)}
              aria-label="Zoom out"
              title="Zoom out (−)"
            >
              <ZoomOut size={18} aria-hidden />
            </button>
            <button
              type="button"
              className="zoom-value"
              onClick={() => pz.zoomTo(1)}
              aria-label={`Zoom ${Math.round(pz.view.zoom * 100)}%. Reset to 100%`}
              title="Reset to 100% (0)"
            >
              {Math.round(pz.view.zoom * 100)}%
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => pz.zoomBy(1.25)}
              aria-label="Zoom in"
              title="Zoom in (+)"
            >
              <ZoomIn size={18} aria-hidden />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={fitAll}
              aria-label="Fit to screen"
              title="Fit to screen (Shift+1)"
            >
              <Maximize size={18} aria-hidden />
            </button>
          </div>

          {importing && (
            <div className="import-progress" role="status">
              <LoaderCircle size={16} aria-hidden className="spin" />
              Adding screenshots {importing.done} / {importing.total}…
            </div>
          )}
        </div>

        {inspectorOpen && (
          <Inspector
            doc={doc}
            step={step}
            stepIndex={stepIndex}
            annotation={annotation}
            onTitle={(v) => step && onTitle(step.id, v)}
            onDescription={(v) => step && onDescription(step.id, v)}
            onMoveStep={moveSelectedStep}
            onDuplicateStep={duplicateStepNow}
            onDeleteStep={deleteStep}
            onSelectAnnotation={(id) => step && onSelectAnnotation(step.id, id)}
            onAnnotationColor={setColor}
            onToggleNumber={toggleNumber}
            onDeleteAnnotation={(id) => {
              if (!step) return
              apply((d) => removeAnnotation(d, step.id, id))
              if (selection.annotationId === id)
                setSelection({ stepId: step.id, annotationId: null })
            }}
            onCardWidth={(w) => apply((d) => setCardWidth(d, w))}
            onShowShortcuts={() => setShortcutsOpen(true)}
          />
        )}
      </div>

      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        doc={doc}
        settings={doc.flow.export}
        onSettings={setExportSettings}
        onExportProject={() => void exportProject()}
      />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  )
}

function ToolButton({
  tool,
  current,
  onSelect,
  label,
  shortcut,
  children,
}: {
  tool: Tool
  current: Tool
  onSelect: (t: Tool) => void
  label: string
  shortcut: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className="icon-btn"
      aria-pressed={current === tool}
      aria-label={`${label} (${shortcut})`}
      title={`${label} (${shortcut})`}
      onClick={() => onSelect(tool)}
    >
      {children}
    </button>
  )
}

function SaveStatus({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state.status === 'error') {
    return (
      <button
        type="button"
        className="save-status save-error"
        onClick={onRetry}
        title={state.error.message}
      >
        <CircleAlert size={16} aria-hidden />
        {state.error.kind === 'quota' ? 'Storage full — not saved' : 'Not saved'} · Retry
      </button>
    )
  }
  const saving = state.status === 'saving' || state.status === 'pending'
  return (
    <span className="save-status" role="status" aria-live="polite">
      {saving ? (
        <LoaderCircle size={16} aria-hidden className="spin" />
      ) : (
        <Check size={16} aria-hidden />
      )}
      {saving ? 'Saving…' : 'Saved'}
    </span>
  )
}
