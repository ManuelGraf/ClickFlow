import { useEffect, useState } from 'react'
import { HardDrive, ShieldCheck, Trash2 } from 'lucide-react'
import { deleteAllData, getStorageUsage, requestPersistence, type StorageUsage } from '../db/db'
import { toStorageError } from '../db/errors'
import { formatBytes } from '../lib/format'
import { blobUrls } from '../hooks/useBlobUrl'
import { useDialogs } from './Dialog'
import { useToast } from './Toasts'

/** Where data lives, how much space it takes, and the wipe-everything button. */
export function StoragePanel({ version, onCleared }: { version: number; onCleared: () => void }) {
  const [usage, setUsage] = useState<StorageUsage | null>(null)
  const dialogs = useDialogs()
  const toast = useToast()

  useEffect(() => {
    let active = true
    getStorageUsage()
      .then((u) => active && setUsage(u))
      .catch(() => active && setUsage(null))
    return () => {
      active = false
    }
  }, [version])

  const quotaShare = usage?.estimate ? usage.estimate.usage / usage.estimate.quota : 0

  const deleteAll = async () => {
    const ok = await dialogs.confirm({
      title: 'Delete all local data?',
      message: (
        <>
          <p>
            This permanently removes every flow and screenshot ClickFlow has stored in this browser
            {usage ? ` (${formatBytes(usage.blobBytes)})` : ''}. Nothing is stored anywhere else, so
            this cannot be undone.
          </p>
          <p>Use “Back up all” first if you might need them again.</p>
        </>
      ),
      confirmLabel: 'Delete everything',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteAllData()
      blobUrls.clear()
      toast('info', 'All local data was deleted.')
    } catch (e) {
      toast('error', toStorageError(e).message)
    }
    onCleared()
  }

  const persist = async () => {
    const granted = await requestPersistence()
    toast(
      granted ? 'success' : 'info',
      granted
        ? 'This browser will keep your flows even when storage runs low.'
        : 'The browser declined. Flows are still saved, but may be cleared if the disk gets full.',
    )
    setUsage((u) => (u ? { ...u, persisted: granted } : u))
  }

  return (
    <section className="storage-panel" aria-labelledby="storage-title">
      <div className="storage-text">
        <h2 id="storage-title">
          <HardDrive size={16} aria-hidden /> Stored only in this browser
        </h2>
        <p className="muted">
          Flows and screenshots are kept in this browser’s IndexedDB on this device. Nothing is
          uploaded, and no account or server is involved. Clearing site data or using another
          browser means starting fresh — use “Back up all” to keep a portable copy.
        </p>
        {usage && (
          <p className="storage-usage">
            ClickFlow uses about <strong>{formatBytes(usage.blobBytes)}</strong> for{' '}
            {usage.blobCount} image{usage.blobCount === 1 ? '' : 's'} across {usage.flowCount} flow
            {usage.flowCount === 1 ? '' : 's'}.
            {usage.estimate && (
              <>
                {' '}
                The browser reports {formatBytes(usage.estimate.usage)} used of{' '}
                {formatBytes(usage.estimate.quota)} available to this site.
              </>
            )}
          </p>
        )}
        {usage?.estimate && (
          <div
            className={`meter ${quotaShare > 0.8 ? 'meter-warn' : ''}`}
            role="meter"
            aria-label="Browser storage used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(quotaShare * 100)}
          >
            <div
              className="meter-fill"
              style={{ width: `${Math.max(1, Math.min(100, quotaShare * 100))}%` }}
            />
          </div>
        )}
        {quotaShare > 0.8 && (
          <p className="notice notice-error" role="alert">
            Storage is almost full. Delete flows you no longer need or export backups and remove
            them.
          </p>
        )}
      </div>
      <div className="storage-actions">
        {usage && usage.persisted === false && (
          <button type="button" className="btn" onClick={() => void persist()}>
            <ShieldCheck size={16} aria-hidden /> Protect from cleanup
          </button>
        )}
        {usage?.persisted && (
          <p className="muted storage-persisted">
            <ShieldCheck size={16} aria-hidden /> Protected from automatic cleanup
          </p>
        )}
        <button type="button" className="btn btn-danger-outline" onClick={() => void deleteAll()}>
          <Trash2 size={16} aria-hidden /> Delete all local data
        </button>
      </div>
    </section>
  )
}
