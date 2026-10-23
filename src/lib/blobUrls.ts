// Reference-counted object URLs for stored blobs. Several cards can show the
// same screenshot (duplicated steps), and components mount/unmount freely, so
// URLs are shared per blob id and revoked once nobody has used them for a
// moment. Nothing else in the app creates long-lived object URLs.

type Loader = (id: string) => Promise<Blob | undefined>

interface Entry {
  count: number
  url: string | null
  promise: Promise<string | null>
  timer?: ReturnType<typeof setTimeout>
  dead: boolean
}

export interface UrlApi {
  create(blob: Blob): string
  revoke(url: string): void
}

const browserUrls: UrlApi = {
  create: (blob) => URL.createObjectURL(blob),
  revoke: (url) => URL.revokeObjectURL(url),
}

export class BlobUrlCache {
  private entries = new Map<string, Entry>()

  constructor(
    private load: Loader,
    private urls: UrlApi = browserUrls,
    /** Grace period before revoking, so a quick unmount/remount reuses the URL. */
    private releaseDelay = 1500,
  ) {}

  /** Synchronous lookup for the first render; null until loaded. */
  peek(id: string): string | null {
    return this.entries.get(id)?.url ?? null
  }

  /** Resolve to an object URL (null if the blob is missing) and hold a reference. */
  acquire(id: string): Promise<string | null> {
    const existing = this.entries.get(id)
    if (existing) {
      existing.count++
      if (existing.timer) clearTimeout(existing.timer)
      existing.timer = undefined
      return existing.promise
    }
    const entry: Entry = { count: 1, url: null, promise: Promise.resolve(null), dead: false }
    entry.promise = this.load(id).then(
      (blob) => {
        if (!blob || entry.dead) return null
        entry.url = this.urls.create(blob)
        return entry.url
      },
      () => null,
    )
    this.entries.set(id, entry)
    return entry.promise
  }

  release(id: string): void {
    const entry = this.entries.get(id)
    if (!entry || entry.count === 0) return
    entry.count--
    if (entry.count > 0) return
    const drop = () => {
      if (entry.count > 0) return
      this.entries.delete(id)
      entry.dead = true
      if (entry.url) this.urls.revoke(entry.url)
      entry.url = null
    }
    if (this.releaseDelay <= 0) drop()
    else entry.timer = setTimeout(drop, this.releaseDelay)
  }

  /** Forget a blob that was replaced or deleted (revokes even if still held). */
  invalidate(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    this.entries.delete(id)
    entry.dead = true
    if (entry.url) this.urls.revoke(entry.url)
    entry.url = null
  }

  /** Revoke everything (used after "Delete all local data"). */
  clear(): void {
    for (const id of [...this.entries.keys()]) this.invalidate(id)
  }

  get size(): number {
    return this.entries.size
  }
}
