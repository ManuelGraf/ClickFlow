// The persistence layer. Every function here is a small, typed operation over
// IndexedDB; callers never see raw IDB requests. All writes that must be
// consistent (a flow with its steps, an import, a deletion) happen inside one
// transaction, so a quota error or crash never leaves half a flow behind.

import { openDB, type IDBPDatabase } from 'idb'
import {
  DEFAULT_CANVAS,
  DEFAULT_EXPORT,
  type BlobRecord,
  type Flow,
  type FlowDoc,
  type Step,
} from '../types'
import { newId } from '../lib/ids'
import { DB_NAME, DB_VERSION, runMigrations, type ClickFlowDB } from './schema'
import { StorageError, toStorageError } from './errors'

let dbPromise: Promise<IDBPDatabase<ClickFlowDB>> | null = null

export function getDb(): Promise<IDBPDatabase<ClickFlowDB>> {
  if (dbPromise) return dbPromise
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new StorageError('unavailable', 'IndexedDB is not available.'))
  }
  const opening = openDB<ClickFlowDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, newVersion, tx) {
      runMigrations(db, oldVersion, newVersion ?? DB_VERSION, tx)
    },
    blocking() {
      // A newer version of the app (another tab) wants to upgrade the schema.
      // Step aside; the next call reopens the database.
      void opening.then((db) => db.close())
      dbPromise = null
    },
    terminated() {
      dbPromise = null
    },
  }).catch((e: unknown) => {
    dbPromise = null
    throw toStorageError(e)
  })
  dbPromise = opening
  return opening
}

/** Close the connection (tests, and before wiping data). */
export async function closeDb(): Promise<void> {
  const pending = dbPromise
  dbPromise = null
  if (pending) (await pending.catch(() => null))?.close()
}

async function run<T>(fn: (db: IDBPDatabase<ClickFlowDB>) => Promise<T>): Promise<T> {
  try {
    return await fn(await getDb())
  } catch (e) {
    throw toStorageError(e)
  }
}

/**
 * Wait for a batch of write requests and the transaction commit. When a
 * transaction aborts, its pending requests fail with a generic AbortError while
 * the real cause (e.g. QuotaExceededError) is on the transaction, so let that
 * one win.
 */
async function commitAll(
  tx: { done: Promise<void> },
  requests: Array<Promise<unknown> | undefined>,
): Promise<void> {
  const results = await Promise.allSettled(requests)
  await tx.done
  const failed = results.find((r) => r.status === 'rejected')
  if (failed) throw failed.reason
}

// ---------------------------------------------------------------- flows

export async function listFlows(): Promise<Flow[]> {
  return run(async (db) => (await db.getAllFromIndex('flows', 'updatedAt')).reverse())
}

export async function createFlow(title = 'Untitled flow', now = Date.now()): Promise<Flow> {
  const flow: Flow = {
    id: newId(),
    title,
    createdAt: now,
    updatedAt: now,
    stepIds: [],
    canvas: { ...DEFAULT_CANVAS },
    export: { ...DEFAULT_EXPORT },
  }
  await run((db) => db.put('flows', flow))
  return flow
}

/** Order steps by the flow's stepIds; tolerate stray or missing records. */
export function orderSteps(flow: Flow, steps: Step[]): Step[] {
  const rank = new Map(flow.stepIds.map((id, i) => [id, i]))
  return [...steps]
    .sort(
      (a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || a.order - b.order,
    )
    .map((s, i) => (s.order === i ? s : { ...s, order: i }))
}

export async function loadFlowDoc(flowId: string): Promise<FlowDoc | undefined> {
  return run(async (db) => {
    const tx = db.transaction(['flows', 'steps'])
    const [flow, steps] = await Promise.all([
      tx.objectStore('flows').get(flowId),
      tx.objectStore('steps').index('flowId').getAll(flowId),
      tx.done,
    ])
    if (!flow) return undefined
    const ordered = orderSteps(flow, steps)
    return { flow: { ...flow, stepIds: ordered.map((s) => s.id) }, steps: ordered }
  })
}

/**
 * Persist a flow and exactly its current steps. Steps of this flow that are no
 * longer in the document are deleted; their screenshot blobs are left for the
 * orphan sweep, so undo within the session can still bring them back.
 */
export async function saveFlowDoc(doc: FlowDoc, now = Date.now()): Promise<Flow> {
  return run(async (db) => {
    const tx = db.transaction(['flows', 'steps'], 'readwrite')
    const flows = tx.objectStore('flows')
    const steps = tx.objectStore('steps')
    const [existing, storedIds] = await Promise.all([
      flows.get(doc.flow.id),
      steps.index('flowId').getAllKeys(doc.flow.id),
    ])
    const keep = new Set(doc.steps.map((s) => s.id))
    const flow: Flow = {
      ...doc.flow,
      stepIds: doc.steps.map((s) => s.id),
      updatedAt: now,
      // The thumbnail is written separately; never clobber a newer one.
      thumbnailBlobId: existing?.thumbnailBlobId ?? doc.flow.thumbnailBlobId,
    }
    if (flow.thumbnailBlobId === undefined) delete flow.thumbnailBlobId
    await commitAll(tx, [
      ...storedIds.filter((id) => !keep.has(id)).map((id) => steps.delete(id)),
      ...doc.steps.map((s, order) => steps.put({ ...s, flowId: flow.id, order })),
      flows.put(flow),
    ])
    return flow
  })
}

export async function renameFlow(flowId: string, title: string, now = Date.now()): Promise<void> {
  await run(async (db) => {
    const tx = db.transaction('flows', 'readwrite')
    const flow = await tx.store.get(flowId)
    if (flow) await tx.store.put({ ...flow, title, updatedAt: now })
    await tx.done
  })
}

/** Copy a flow. Screenshot blobs are shared (they are immutable), not copied. */
export async function duplicateFlow(flowId: string, now = Date.now()): Promise<Flow | undefined> {
  return run(async (db) => {
    const tx = db.transaction(['flows', 'steps', 'blobs'], 'readwrite')
    const source = await tx.objectStore('flows').get(flowId)
    if (!source) {
      await tx.done
      return undefined
    }
    const steps = orderSteps(source, await tx.objectStore('steps').index('flowId').getAll(flowId))
    const id = newId()
    const copies: Step[] = steps.map((s) => ({
      ...s,
      id: newId(),
      flowId: id,
      annotations: s.annotations.map((a) => ({ ...a, id: newId() })),
    }))
    const flow: Flow = {
      ...source,
      id,
      title: `${source.title} (copy)`,
      createdAt: now,
      updatedAt: now,
      stepIds: copies.map((s) => s.id),
    }
    delete flow.thumbnailBlobId
    if (source.thumbnailBlobId) {
      const thumb = await tx.objectStore('blobs').get(source.thumbnailBlobId)
      if (thumb) {
        flow.thumbnailBlobId = newId()
        await tx.objectStore('blobs').put({ ...thumb, id: flow.thumbnailBlobId, createdAt: now })
      }
    }
    await commitAll(tx, [
      ...copies.map((s) => tx.objectStore('steps').put(s)),
      tx.objectStore('flows').put(flow),
    ])
    return flow
  })
}

/** Delete a flow, its steps, its thumbnail and any screenshots only it used. */
export async function deleteFlow(flowId: string): Promise<void> {
  await run(async (db) => {
    const tx = db.transaction(['flows', 'steps', 'blobs'], 'readwrite')
    const flows = tx.objectStore('flows')
    const steps = tx.objectStore('steps')
    const blobs = tx.objectStore('blobs')
    const flow = await flows.get(flowId)
    const own = await steps.index('flowId').getAll(flowId)
    const candidates = new Set(own.map((s) => s.screenshotBlobId))
    // Shared with another flow (duplicate) or another step? Keep those.
    let cursor = await steps.openCursor()
    while (cursor) {
      if (cursor.value.flowId !== flowId) candidates.delete(cursor.value.screenshotBlobId)
      cursor = await cursor.continue()
    }
    await commitAll(tx, [
      ...own.map((s) => steps.delete(s.id)),
      ...[...candidates].map((id) => blobs.delete(id)),
      flow?.thumbnailBlobId ? blobs.delete(flow.thumbnailBlobId) : undefined,
      flows.delete(flowId),
    ])
  })
}

// ---------------------------------------------------------------- blobs

export async function putBlobs(records: BlobRecord[]): Promise<void> {
  if (records.length === 0) return
  await run(async (db) => {
    const tx = db.transaction('blobs', 'readwrite')
    await commitAll(
      tx,
      records.map((r) => tx.store.put(r)),
    )
  })
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  return run(async (db) => (await db.get('blobs', id))?.blob)
}

/** Store a new thumbnail and drop the previous one, without touching updatedAt. */
export async function setFlowThumbnail(flowId: string, blob: Blob, now = Date.now()) {
  return run(async (db) => {
    const tx = db.transaction(['flows', 'blobs'], 'readwrite')
    const flow = await tx.objectStore('flows').get(flowId)
    if (!flow) {
      await tx.done
      return undefined
    }
    const id = newId()
    const previous = flow.thumbnailBlobId
    await commitAll(tx, [
      tx.objectStore('blobs').put({ id, mimeType: blob.type, blob, createdAt: now }),
      tx.objectStore('flows').put({ ...flow, thumbnailBlobId: id }),
      previous ? tx.objectStore('blobs').delete(previous) : undefined,
    ])
    return id
  })
}

/**
 * Mark-and-sweep: delete blobs no step or flow references. Blobs younger than
 * the grace period survive, because another open tab may have stored a
 * screenshot whose step is still waiting for its debounced autosave.
 */
export async function sweepOrphanBlobs(now = Date.now(), graceMs = 10 * 60_000): Promise<number> {
  return run(async (db) => {
    const tx = db.transaction(['flows', 'steps', 'blobs'], 'readwrite')
    const referenced = new Set<string>()
    for (const s of await tx.objectStore('steps').getAll()) referenced.add(s.screenshotBlobId)
    for (const f of await tx.objectStore('flows').getAll()) {
      if (f.thumbnailBlobId) referenced.add(f.thumbnailBlobId)
    }
    let removed = 0
    let cursor = await tx.objectStore('blobs').openCursor()
    while (cursor) {
      const record = cursor.value
      if (!referenced.has(record.id) && now - record.createdAt > graceMs) {
        await cursor.delete()
        removed++
      }
      cursor = await cursor.continue()
    }
    await tx.done
    return removed
  })
}

// ---------------------------------------------------------------- storage

export interface StorageUsage {
  /** Bytes of screenshots and thumbnails stored by ClickFlow. */
  blobBytes: number
  blobCount: number
  flowCount: number
  /** What the browser reports for this origin, when available. */
  estimate?: { usage: number; quota: number }
  persisted?: boolean
}

export async function getStorageUsage(): Promise<StorageUsage> {
  const counts = await run(async (db) => {
    const tx = db.transaction(['blobs', 'flows'])
    let blobBytes = 0
    let blobCount = 0
    // Reading a record yields a Blob handle; its size is known without reading data.
    let cursor = await tx.objectStore('blobs').openCursor()
    while (cursor) {
      blobBytes += cursor.value.blob.size
      blobCount++
      cursor = await cursor.continue()
    }
    const flowCount = await tx.objectStore('flows').count()
    await tx.done
    return { blobBytes, blobCount, flowCount }
  })
  const usage: StorageUsage = { ...counts }
  try {
    const estimate = await navigator.storage?.estimate?.()
    if (estimate?.quota) usage.estimate = { usage: estimate.usage ?? 0, quota: estimate.quota }
    usage.persisted = await navigator.storage?.persisted?.()
  } catch {
    // Estimates are best-effort; some browsers do not expose them.
  }
  return usage
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

/** Remove every flow, step and blob. Clears stores rather than deleting the
 * database so other open tabs cannot block it. */
export async function deleteAllData(): Promise<void> {
  await run(async (db) => {
    const tx = db.transaction(['flows', 'steps', 'blobs'], 'readwrite')
    await commitAll(tx, [
      tx.objectStore('flows').clear(),
      tx.objectStore('steps').clear(),
      tx.objectStore('blobs').clear(),
    ])
  })
}

// ---------------------------------------------------------------- backup

export interface ProjectData {
  flows: Flow[]
  steps: Step[]
  blobs: BlobRecord[]
}

/** Everything needed to back up the given flows (all flows when omitted). */
export async function collectProject(flowIds?: string[]): Promise<ProjectData> {
  return run(async (db) => {
    const tx = db.transaction(['flows', 'steps', 'blobs'])
    const all = await tx.objectStore('flows').getAll()
    const wanted = flowIds ? new Set(flowIds) : null
    const flows = all.filter((f) => !wanted || wanted.has(f.id))
    const steps: Step[] = []
    for (const flow of flows) {
      steps.push(...orderSteps(flow, await tx.objectStore('steps').index('flowId').getAll(flow.id)))
    }
    const blobIds = new Set<string>(steps.map((s) => s.screenshotBlobId))
    for (const f of flows) if (f.thumbnailBlobId) blobIds.add(f.thumbnailBlobId)
    const blobs: BlobRecord[] = []
    for (const id of blobIds) {
      const record = await tx.objectStore('blobs').get(id)
      if (record) blobs.push(record)
    }
    await tx.done
    // Steps whose screenshot went missing cannot be restored meaningfully.
    const present = new Set(blobs.map((b) => b.id))
    const kept = steps.filter((s) => present.has(s.screenshotBlobId))
    const keptIds = new Set(kept.map((s) => s.id))
    return {
      flows: flows.map((f) => {
        const flow = { ...f, stepIds: f.stepIds.filter((id) => keptIds.has(id)) }
        if (flow.thumbnailBlobId && !present.has(flow.thumbnailBlobId)) delete flow.thumbnailBlobId
        return flow
      }),
      steps: kept,
      blobs,
    }
  })
}

/**
 * Add imported flows. Every id is regenerated so importing the same backup
 * twice (or into the browser it came from) never overwrites existing work.
 * Returns the new flows.
 */
export async function importProjectData(data: ProjectData, now = Date.now()): Promise<Flow[]> {
  const blobIds = new Map(data.blobs.map((b) => [b.id, newId()]))
  const flowIds = new Map(data.flows.map((f) => [f.id, newId()]))
  const stepIds = new Map(data.steps.map((s) => [s.id, newId()]))

  const flows: Flow[] = data.flows.map((f) => {
    const flow: Flow = {
      ...f,
      id: flowIds.get(f.id)!,
      stepIds: f.stepIds.map((id) => stepIds.get(id)!),
      updatedAt: Math.min(f.updatedAt, now),
    }
    if (f.thumbnailBlobId) flow.thumbnailBlobId = blobIds.get(f.thumbnailBlobId)!
    return flow
  })
  const steps: Step[] = data.steps.map((s) => ({
    ...s,
    id: stepIds.get(s.id)!,
    flowId: flowIds.get(s.flowId)!,
    screenshotBlobId: blobIds.get(s.screenshotBlobId)!,
  }))
  const blobs: BlobRecord[] = data.blobs.map((b) => ({ ...b, id: blobIds.get(b.id)! }))

  await run(async (db) => {
    const tx = db.transaction(['flows', 'steps', 'blobs'], 'readwrite')
    await commitAll(tx, [
      ...blobs.map((b) => tx.objectStore('blobs').put(b)),
      ...steps.map((s) => tx.objectStore('steps').put(s)),
      ...flows.map((f) => tx.objectStore('flows').put(f)),
    ])
  })
  return flows
}
