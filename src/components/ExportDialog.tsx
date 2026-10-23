import { useMemo, useState } from 'react'
import { Download, FileArchive } from 'lucide-react'
import type { ExportBackground, ExportScale, ExportSettings, FlowDoc } from '../types'
import { exportFlowPng, exportSizeFor } from '../lib/exportFlow'
import { downloadBlob } from '../lib/download'
import { fileNameFor, formatBytes } from '../lib/format'
import { Dialog } from './Dialog'

interface ExportDialogProps {
  open: boolean
  onClose: () => void
  doc: FlowDoc
  settings: ExportSettings
  onSettings: (settings: ExportSettings) => void
  onExportProject: () => void
}

const BACKGROUNDS: { value: ExportBackground; label: string }[] = [
  { value: 'white', label: 'White' },
  { value: 'light-gray', label: 'Light gray' },
  { value: 'transparent', label: 'Transparent' },
]

export function ExportDialog({
  open,
  onClose,
  doc,
  settings,
  onSettings,
  onExportProject,
}: ExportDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const size = useMemo(
    () => (open ? exportSizeFor(doc, settings.scale) : null),
    [open, doc, settings.scale],
  )

  const run = async () => {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const blob = await exportFlowPng(doc, settings)
      downloadBlob(blob, fileNameFor(doc.flow.title, 'png'))
      setDone(`Saved ${fileNameFor(doc.flow.title, 'png')} (${formatBytes(blob.size)}).`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.')
    } finally {
      setBusy(false)
    }
  }

  const close = () => {
    if (busy) return
    setError(null)
    setDone(null)
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Export PNG"
      footer={
        <>
          <button type="button" className="btn btn-link" onClick={onExportProject} disabled={busy}>
            <FileArchive size={16} aria-hidden /> Save project file instead
          </button>
          <span className="button-row-spacer" />
          <button type="button" className="btn" onClick={close} disabled={busy}>
            Close
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void run()}
            disabled={busy || doc.steps.length === 0}
            data-autofocus
          >
            <Download size={16} aria-hidden /> {busy ? 'Exporting…' : 'Export PNG'}
          </button>
        </>
      }
    >
      <p className="muted small">
        The whole flow is rendered — title, every screenshot, labels, highlights and arrows — not
        just what is on screen. Rendering happens in this browser.
      </p>

      <fieldset className="field">
        <legend className="field-label">Resolution</legend>
        <div className="segmented" role="radiogroup" aria-label="Resolution">
          {([1, 2] as ExportScale[]).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={settings.scale === s}
              onClick={() => onSettings({ ...settings, scale: s })}
            >
              {s}×{s === 2 ? ' (sharp on retina)' : ''}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend className="field-label">Background</legend>
        <div className="segmented" role="radiogroup" aria-label="Background">
          {BACKGROUNDS.map((b) => (
            <button
              key={b.value}
              type="button"
              role="radio"
              aria-checked={settings.background === b.value}
              onClick={() => onSettings({ ...settings, background: b.value })}
            >
              <span className={`bg-chip bg-chip-${b.value}`} aria-hidden />
              {b.label}
            </button>
          ))}
        </div>
      </fieldset>

      {doc.steps.length === 0 ? (
        <p className="notice">Add at least one screenshot to export.</p>
      ) : (
        size && (
          <p className="small">
            Output:{' '}
            <strong>
              {size.width.toLocaleString()} × {size.height.toLocaleString()} px
            </strong>
            {size.reduced && (
              <span className="warn">
                {' '}
                — reduced from {settings.scale}× to fit the browser’s maximum image size.
              </span>
            )}
          </p>
        )
      )}

      <div aria-live="polite">
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        {done && <p className="notice notice-success">{done}</p>}
      </div>
    </Dialog>
  )
}
