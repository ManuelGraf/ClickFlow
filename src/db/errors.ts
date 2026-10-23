export type StorageErrorKind = 'quota' | 'unavailable' | 'unknown'

export class StorageError extends Error {
  constructor(
    readonly kind: StorageErrorKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'StorageError'
  }
}

const MESSAGES: Record<StorageErrorKind, string> = {
  quota:
    'Browser storage is full. Delete flows or screenshots you no longer need, or export a backup and remove old flows.',
  unavailable:
    'This browser does not allow local storage here (private windows and some privacy settings block IndexedDB). ClickFlow needs it to keep your flows.',
  unknown: 'Saving to browser storage failed.',
}

function errorName(e: unknown): string {
  if (e && typeof e === 'object' && 'name' in e && typeof e.name === 'string') return e.name
  return ''
}

function errorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof e.message === 'string')
    return e.message
  return String(e)
}

/** Map the many shapes of IndexedDB failure onto something the UI can explain. */
export function toStorageError(e: unknown): StorageError {
  if (e instanceof StorageError) return e
  const name = errorName(e)
  const message = errorMessage(e)
  // Aborted transactions surface the underlying cause as `error` on the tx.
  const inner =
    e && typeof e === 'object' && 'cause' in e && e.cause ? toStorageError(e.cause) : null
  if (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    /quota/i.test(message) ||
    inner?.kind === 'quota'
  ) {
    return new StorageError('quota', MESSAGES.quota, { cause: e })
  }
  if (
    name === 'SecurityError' ||
    name === 'InvalidStateError' ||
    name === 'NotSupportedError' ||
    /indexeddb.*(not available|unavailable)/i.test(message)
  ) {
    return new StorageError('unavailable', MESSAGES.unavailable, { cause: e })
  }
  return new StorageError('unknown', `${MESSAGES.unknown} ${message}`.trim(), { cause: e })
}
