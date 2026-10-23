import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { BlobRecord, FlowDoc, Step } from '../types'
import {
  closeDb,
  collectProject,
  createFlow,
  deleteAllData,
  deleteFlow,
  duplicateFlow,
  getBlob,
  getStorageUsage,
  importProjectData,
  listFlows,
  loadFlowDoc,
  putBlobs,
  renameFlow,
  saveFlowDoc,
  setFlowThumbnail,
  sweepOrphanBlobs,
} from './db'
import { toStorageError } from './errors'
import { MIGRATIONS, DB_VERSION } from './schema'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

function blobRecord(id: string, createdAt = 0): BlobRecord {
  return { id, mimeType: 'image/png', blob: new Blob([PNG], { type: 'image/png' }), createdAt }
}

function step(id: string, flowId: string, blobId: string, extra: Partial<Step> = {}): Step {
  return {
    id,
    flowId,
    screenshotBlobId: blobId,
    order: 0,
    title: id,
    description: '',
    imageWidth: 1440,
    imageHeight: 900,
    annotations: [],
    ...extra,
  }
}

beforeEach(async () => {
  await closeDb()
  // A fresh in-memory IndexedDB for every test.
  globalThis.indexedDB = new IDBFactory()
})

afterEach(async () => {
  await closeDb()
})

async function seedFlow(title = 'Checkout'): Promise<FlowDoc> {
  const flow = await createFlow(title, 1000)
  await putBlobs([blobRecord('b1'), blobRecord('b2')])
  const doc: FlowDoc = {
    flow,
    steps: [
      step('s1', flow.id, 'b1', {
        annotations: [{ id: 'a1', type: 'ellipse', x: 0.1, y: 0.2, w: 0.3, h: 0.1, color: 'red' }],
      }),
      step('s2', flow.id, 'b2'),
    ],
  }
  await saveFlowDoc(doc, 2000)
  return doc
}

describe('schema', () => {
  it('has a migration for every version', () => {
    for (let v = 1; v <= DB_VERSION; v++) expect(MIGRATIONS[v]).toBeTypeOf('function')
  })
})

describe('flows and steps', () => {
  it('round-trips a flow with ordered steps, annotations and blobs', async () => {
    const doc = await seedFlow()
    const loaded = await loadFlowDoc(doc.flow.id)
    expect(loaded?.flow.title).toBe('Checkout')
    expect(loaded?.flow.updatedAt).toBe(2000)
    expect(loaded?.steps.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(loaded?.steps.map((s) => s.order)).toEqual([0, 1])
    expect(loaded?.steps[0]?.annotations[0]).toMatchObject({ x: 0.1, color: 'red' })
    const blob = await getBlob('b1')
    expect(blob?.size).toBe(PNG.length)
  })

  it('persists reordering and deletes removed steps', async () => {
    const doc = await seedFlow()
    const [s1, s2] = doc.steps as [Step, Step]
    await saveFlowDoc({ flow: doc.flow, steps: [s2] }, 3000)
    let loaded = await loadFlowDoc(doc.flow.id)
    expect(loaded?.steps.map((s) => s.id)).toEqual(['s2'])

    await saveFlowDoc({ flow: doc.flow, steps: [s2, s1] }, 4000)
    loaded = await loadFlowDoc(doc.flow.id)
    expect(loaded?.flow.stepIds).toEqual(['s2', 's1'])
    expect(loaded?.steps.map((s) => s.order)).toEqual([0, 1])
  })

  it('lists flows newest first and renames', async () => {
    const a = await createFlow('A', 1)
    const b = await createFlow('B', 2)
    expect((await listFlows()).map((f) => f.id)).toEqual([b.id, a.id])
    await renameFlow(a.id, 'Renamed', 3)
    const flows = await listFlows()
    expect(flows[0]).toMatchObject({ id: a.id, title: 'Renamed' })
  })

  it('does not let a save clobber a newer thumbnail', async () => {
    const doc = await seedFlow()
    const thumbId = await setFlowThumbnail(doc.flow.id, new Blob([PNG], { type: 'image/png' }))
    await saveFlowDoc(doc, 5000) // doc.flow has no thumbnailBlobId
    expect((await loadFlowDoc(doc.flow.id))?.flow.thumbnailBlobId).toBe(thumbId)
  })

  it('replaces the previous thumbnail blob', async () => {
    const doc = await seedFlow()
    const first = await setFlowThumbnail(doc.flow.id, new Blob([PNG]))
    const second = await setFlowThumbnail(doc.flow.id, new Blob([PNG]))
    expect(first).not.toBe(second)
    expect(await getBlob(first!)).toBeUndefined()
    expect(await getBlob(second!)).toBeDefined()
  })
})

describe('duplicate and delete', () => {
  it('duplicates with fresh ids and shared screenshots', async () => {
    const doc = await seedFlow()
    const copy = await duplicateFlow(doc.flow.id, 9000)
    const loaded = await loadFlowDoc(copy!.id)
    expect(loaded?.flow.title).toBe('Checkout (copy)')
    expect(loaded?.steps).toHaveLength(2)
    expect(loaded?.steps[0]?.id).not.toBe('s1')
    expect(loaded?.steps[0]?.screenshotBlobId).toBe('b1')
    expect(loaded?.steps[0]?.annotations[0]?.id).not.toBe('a1')
  })

  it('deleting a flow keeps screenshots another flow still uses', async () => {
    const doc = await seedFlow()
    const copy = await duplicateFlow(doc.flow.id)
    await deleteFlow(doc.flow.id)
    expect(await loadFlowDoc(doc.flow.id)).toBeUndefined()
    expect(await getBlob('b1')).toBeDefined()

    await deleteFlow(copy!.id)
    expect(await getBlob('b1')).toBeUndefined()
    expect(await getBlob('b2')).toBeUndefined()
    expect(await listFlows()).toEqual([])
  })

  it('sweeps unreferenced blobs after the grace period only', async () => {
    await seedFlow()
    await putBlobs([blobRecord('orphan-old', 0), blobRecord('orphan-new', 100_000)])
    const removed = await sweepOrphanBlobs(100_000 + 1000, 60_000)
    expect(removed).toBe(1)
    expect(await getBlob('orphan-old')).toBeUndefined()
    expect(await getBlob('orphan-new')).toBeDefined()
    expect(await getBlob('b1')).toBeDefined()
  })

  it('deletes all data', async () => {
    await seedFlow()
    await deleteAllData()
    expect(await listFlows()).toEqual([])
    const usage = await getStorageUsage()
    expect(usage).toMatchObject({ blobBytes: 0, blobCount: 0, flowCount: 0 })
  })

  it('reports stored bytes', async () => {
    await seedFlow()
    const usage = await getStorageUsage()
    expect(usage.blobCount).toBe(2)
    expect(usage.blobBytes).toBe(PNG.length * 2)
    expect(usage.flowCount).toBe(1)
  })
})

describe('backup data', () => {
  it('collects and re-imports flows under new ids', async () => {
    const doc = await seedFlow()
    const data = await collectProject([doc.flow.id])
    expect(data.flows).toHaveLength(1)
    expect(data.steps).toHaveLength(2)
    expect(data.blobs).toHaveLength(2)

    const [imported] = await importProjectData(data)
    expect(imported!.id).not.toBe(doc.flow.id)
    const loaded = await loadFlowDoc(imported!.id)
    expect(loaded?.steps.map((s) => s.title)).toEqual(['s1', 's2'])
    expect(loaded?.steps[0]?.screenshotBlobId).not.toBe('b1')
    expect(await getBlob(loaded!.steps[0]!.screenshotBlobId)).toBeDefined()
    expect(await listFlows()).toHaveLength(2)
  })

  it('drops steps whose screenshot is missing when collecting', async () => {
    const flow = await createFlow('Broken')
    await saveFlowDoc({ flow, steps: [step('x', flow.id, 'missing')] })
    const data = await collectProject()
    expect(data.steps).toEqual([])
    expect(data.flows[0]?.stepIds).toEqual([])
  })
})

describe('error classification', () => {
  it('recognises quota errors', () => {
    expect(toStorageError(new DOMException('full', 'QuotaExceededError')).kind).toBe('quota')
    expect(toStorageError({ name: 'NS_ERROR_DOM_QUOTA_REACHED', message: '' }).kind).toBe('quota')
  })

  it('recognises unavailable storage', () => {
    expect(toStorageError(new DOMException('no', 'SecurityError')).kind).toBe('unavailable')
  })

  it('falls back to unknown', () => {
    expect(toStorageError(new Error('boom')).kind).toBe('unknown')
  })
})
