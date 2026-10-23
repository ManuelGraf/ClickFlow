import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Copy,
  Download,
  FileUp,
  ImagePlus,
  LayoutTemplate,
  MousePointerClick,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'
import type { Flow } from '../types'
import {
  deleteFlow,
  duplicateFlow,
  listFlows,
  loadFlowDoc,
  renameFlow,
  setFlowThumbnail,
  sweepOrphanBlobs,
} from '../db/db'
import { renderThumbnail } from '../lib/exportFlow'
import { toStorageError } from '../db/errors'
import { ProjectFileError } from '../db/projectFile'
import { formatDateTime, formatRelative, matchesSearch } from '../lib/format'
import { ACCEPT_ATTR, hasFiles, imageFilesFrom } from '../lib/images'
import { writesSettled } from '../lib/pending'
import { exportProjectFile, importProjectFile, PROJECT_ACCEPT } from '../lib/projectIO'
import { useBlobUrl } from '../hooks/useBlobUrl'
import { useDialogs } from './Dialog'
import { useToast } from './Toasts'
import { StoragePanel } from './StoragePanel'
import { Logo } from './Logo'

interface LibraryProps {
  onOpen: (flowId: string) => void
  /** Create a flow, optionally seeded with screenshots, and open it. */
  onCreate: (files?: File[]) => void
}

type Load =
  { status: 'loading' } | { status: 'ready'; flows: Flow[] } | { status: 'error'; message: string }

export function Library({ onOpen, onCreate }: LibraryProps) {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [dragging, setDragging] = useState(false)
  const [storageVersion, setStorageVersion] = useState(0)
  const importInput = useRef<HTMLInputElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const dialogs = useDialogs()
  const toast = useToast()

  const refresh = useCallback(async () => {
    try {
      setLoad({ status: 'ready', flows: await listFlows() })
    } catch (e) {
      setLoad({ status: 'error', message: toStorageError(e).message })
    }
    setStorageVersion((v) => v + 1)
  }, [])

  useEffect(() => {
    void (async () => {
      await writesSettled()
      // Housekeeping: drop screenshots no flow uses any more (deleted steps).
      await sweepOrphanBlobs().catch(() => 0)
      await refresh()
    })()
  }, [refresh])

  // Backfill thumbnails for flows that have none yet (imported backups, or a
  // flow left before its thumbnail was rendered). One at a time, in the
  // background; each flow is attempted once per visit.
  const thumbAttempted = useRef(new Set<string>())
  useEffect(() => {
    if (load.status !== 'ready') return
    const todo = load.flows.filter(
      (f) => !f.thumbnailBlobId && f.stepIds.length > 0 && !thumbAttempted.current.has(f.id),
    )
    if (todo.length === 0) return
    // No cancellation: the state patch below is keyed by id, so it applies
    // cleanly even if the list was refreshed meanwhile.
    void (async () => {
      for (const flow of todo) {
        thumbAttempted.current.add(flow.id)
        try {
          const doc = await loadFlowDoc(flow.id)
          const blob = doc && (await renderThumbnail(doc))
          const id = blob && (await setFlowThumbnail(flow.id, blob))
          if (!id) continue
          setLoad((l) =>
            l.status === 'ready'
              ? {
                  ...l,
                  flows: l.flows.map((f) => (f.id === flow.id ? { ...f, thumbnailBlobId: id } : f)),
                }
              : l,
          )
        } catch {
          // Thumbnails are optional; the card shows a placeholder.
        }
      }
    })()
  }, [load])

  // Paste screenshots anywhere on the library to start a new flow.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (document.querySelector('dialog[open]')) return
      const files = imageFilesFrom(e.clipboardData)
      if (files.length === 0) return
      e.preventDefault()
      onCreate(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [onCreate])

  const guard = async (work: () => Promise<void>) => {
    try {
      await work()
    } catch (e) {
      toast('error', e instanceof ProjectFileError ? e.message : toStorageError(e).message)
    }
    await refresh()
  }

  const rename = (flow: Flow) =>
    guard(async () => {
      const title = await dialogs.prompt({
        title: 'Rename flow',
        label: 'Title',
        initial: flow.title,
        confirmLabel: 'Rename',
      })
      if (title && title !== flow.title) await renameFlow(flow.id, title)
    })

  const duplicate = (flow: Flow) =>
    guard(async () => {
      await duplicateFlow(flow.id)
      toast('success', `Duplicated “${flow.title}”.`)
    })

  const remove = (flow: Flow) =>
    guard(async () => {
      const ok = await dialogs.confirm({
        title: 'Delete flow?',
        message: (
          <p>
            “{flow.title}” and its {flow.stepIds.length} screenshot
            {flow.stepIds.length === 1 ? '' : 's'} will be removed from this browser. This cannot be
            undone.
          </p>
        ),
        confirmLabel: 'Delete flow',
        danger: true,
      })
      if (!ok) return
      await deleteFlow(flow.id)
      toast('info', `Deleted “${flow.title}”.`)
    })

  const exportOne = (flow: Flow) => guard(async () => void (await exportProjectFile(flow)))

  const backupAll = () =>
    guard(async () => {
      const count = await exportProjectFile()
      toast('success', `Exported ${count} flow${count === 1 ? '' : 's'} to a backup file.`)
    })

  const importFile = (file: File) =>
    guard(async () => {
      const flows = await importProjectFile(file)
      toast('success', `Imported ${flows.length} flow${flows.length === 1 ? '' : 's'}.`)
    })

  const flows = load.status === 'ready' ? load.flows : []
  const visible = flows.filter((f) => matchesSearch(f.title, query))

  return (
    <div
      className="library"
      onDragOver={(e) => {
        if (!hasFiles(e.dataTransfer)) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node))
          setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const files = imageFilesFrom(e.dataTransfer)
        const project = files.length === 0 ? Array.from(e.dataTransfer.files)[0] : undefined
        if (files.length > 0) onCreate(files)
        else if (project) void importFile(project)
      }}
    >
      <header className="topbar">
        <div className="brand">
          <Logo />
          <span className="brand-name">ClickFlow</span>
        </div>
        <div className="topbar-spacer" />
        <button type="button" className="btn" onClick={() => importInput.current?.click()}>
          <Upload size={16} aria-hidden /> Import
        </button>
        <button
          type="button"
          className="btn"
          onClick={backupAll}
          disabled={flows.length === 0}
          title="Save every flow and screenshot into one .clickflow file"
        >
          <Download size={16} aria-hidden /> Back up all
        </button>
        <button type="button" className="btn btn-primary" onClick={() => onCreate()}>
          <Plus size={16} aria-hidden /> New flow
        </button>
        <input
          ref={importInput}
          type="file"
          accept={PROJECT_ACCEPT}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void importFile(file)
          }}
        />
        <input
          ref={imageInput}
          type="file"
          accept={ACCEPT_ATTR}
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = ''
            if (files.length) onCreate(files)
          }}
        />
      </header>

      <main className="library-main">
        {load.status === 'loading' && (
          <p className="muted center-pad" aria-busy="true">
            Loading your flows…
          </p>
        )}

        {load.status === 'error' && (
          <div className="notice notice-error" role="alert">
            <p>{load.message}</p>
            <button type="button" className="btn" onClick={() => void refresh()}>
              Try again
            </button>
          </div>
        )}

        {load.status === 'ready' && flows.length === 0 && (
          <Welcome onCreate={() => onCreate()} onPick={() => imageInput.current?.click()} />
        )}

        {load.status === 'ready' && flows.length > 0 && (
          <>
            <div className="library-toolbar">
              <h1 className="library-title">Your flows</h1>
              <label className="search">
                <Search size={16} aria-hidden />
                <span className="visually-hidden">Search flows by title</span>
                <input
                  type="search"
                  className="input"
                  placeholder="Search by title"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            </div>
            <p className="muted library-hint">
              Tip: drop or paste screenshots anywhere on this page to start a new flow.
            </p>
            {visible.length === 0 ? (
              <p className="muted center-pad">No flows match “{query}”.</p>
            ) : (
              <ul className="flow-grid" aria-label="Saved flows">
                {visible.map((flow) => (
                  <FlowCard
                    key={flow.id}
                    flow={flow}
                    onOpen={() => onOpen(flow.id)}
                    onRename={() => void rename(flow)}
                    onDuplicate={() => void duplicate(flow)}
                    onExport={() => void exportOne(flow)}
                    onDelete={() => void remove(flow)}
                  />
                ))}
              </ul>
            )}
          </>
        )}

        <StoragePanel version={storageVersion} onCleared={() => void refresh()} />
      </main>

      {dragging && (
        <div className="drop-overlay" aria-hidden>
          <div className="drop-overlay-box">
            <ImagePlus size={32} />
            <p>Drop screenshots to start a new flow</p>
            <p className="muted">or a .clickflow file to import it</p>
          </div>
        </div>
      )}
    </div>
  )
}

function Welcome({ onCreate, onPick }: { onCreate: () => void; onPick: () => void }) {
  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <h1 id="welcome-title">Turn screenshots into a click-flow diagram</h1>
      <ol className="welcome-steps">
        <li>
          <ImagePlus size={22} aria-hidden />
          <strong>Drop screenshots</strong>
          <span>Drag them in, paste with Ctrl+V, or pick files. They line up left to right.</span>
        </li>
        <li>
          <MousePointerClick size={22} aria-hidden />
          <strong>Circle the clicks</strong>
          <span>Highlight buttons and add numbered markers, titles and notes.</span>
        </li>
        <li>
          <LayoutTemplate size={22} aria-hidden />
          <strong>Export a PNG</strong>
          <span>The whole flow with arrows, in 1× or 2× resolution.</span>
        </li>
      </ol>
      <div className="welcome-actions">
        <button type="button" className="btn btn-primary btn-lg" onClick={onPick}>
          <ImagePlus size={18} aria-hidden /> Choose screenshots
        </button>
        <button type="button" className="btn btn-lg" onClick={onCreate}>
          <Plus size={18} aria-hidden /> Start an empty flow
        </button>
      </div>
      <p className="muted">
        Or drop / paste screenshots anywhere on this page. Have a backup?{' '}
        <FileUp size={14} aria-hidden className="inline-icon" /> Use Import above.
      </p>
    </section>
  )
}

interface FlowCardProps {
  flow: Flow
  onOpen: () => void
  onRename: () => void
  onDuplicate: () => void
  onExport: () => void
  onDelete: () => void
}

function FlowCard({ flow, onOpen, onRename, onDuplicate, onExport, onDelete }: FlowCardProps) {
  const thumb = useBlobUrl(flow.thumbnailBlobId)
  const steps = flow.stepIds.length
  return (
    <li className="flow-card">
      <button
        type="button"
        className="flow-card-open"
        onClick={onOpen}
        aria-label={`Open ${flow.title}`}
      >
        <div className="flow-thumb">
          {thumb.url ? (
            <img src={thumb.url} alt="" decoding="async" />
          ) : (
            <LayoutTemplate size={32} aria-hidden className="flow-thumb-empty" />
          )}
        </div>
      </button>
      <div className="flow-card-info">
        <h2 className="flow-card-title" title={flow.title}>
          {flow.title}
        </h2>
        <p className="muted flow-card-meta">
          {steps} step{steps === 1 ? '' : 's'} · Edited{' '}
          <time
            dateTime={new Date(flow.updatedAt).toISOString()}
            title={formatDateTime(flow.updatedAt)}
          >
            {formatRelative(flow.updatedAt)}
          </time>
        </p>
      </div>
      <div className="flow-card-actions">
        <button
          type="button"
          className="icon-btn"
          onClick={onRename}
          aria-label={`Rename ${flow.title}`}
          title="Rename"
        >
          <Pencil size={16} aria-hidden />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={onDuplicate}
          aria-label={`Duplicate ${flow.title}`}
          title="Duplicate"
        >
          <Copy size={16} aria-hidden />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={onExport}
          aria-label={`Export ${flow.title} as a project file`}
          title="Export project file"
        >
          <Download size={16} aria-hidden />
        </button>
        <button
          type="button"
          className="icon-btn icon-btn-danger"
          onClick={onDelete}
          aria-label={`Delete ${flow.title}`}
          title="Delete"
        >
          <Trash2 size={16} aria-hidden />
        </button>
      </div>
    </li>
  )
}
