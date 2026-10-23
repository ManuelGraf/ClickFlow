import { describe, expect, it } from 'vitest'
import type { Flow, Step } from '../types'
import type { ProjectData } from './db'
import {
  decodeProject,
  encodeProject,
  MAGIC,
  ProjectFileError,
  validateManifest,
} from './projectFile'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])

function sample(): ProjectData {
  const flow: Flow = {
    id: 'f1',
    title: 'Sign-up',
    createdAt: 1,
    updatedAt: 2,
    stepIds: ['s1', 's2'],
    canvas: { cardWidth: 640 },
    export: { scale: 2, background: 'white' },
  }
  const base: Omit<Step, 'id' | 'screenshotBlobId' | 'order'> = {
    flowId: 'f1',
    title: 'Open',
    description: 'Click the button',
    imageWidth: 1440,
    imageHeight: 900,
    annotations: [],
  }
  return {
    flows: [flow],
    steps: [
      {
        ...base,
        id: 's1',
        order: 0,
        screenshotBlobId: 'b1',
        annotations: [
          { id: 'a', type: 'marker', x: 0.5, y: 0.5, w: 0.05, h: 0.08, color: 'blue', number: 1 },
        ],
      },
      { ...base, id: 's2', order: 1, screenshotBlobId: 'b2' },
    ],
    blobs: [
      { id: 'b1', mimeType: 'image/png', blob: new Blob([PNG]), createdAt: 5 },
      { id: 'b2', mimeType: 'image/jpeg', blob: new Blob([JPEG]), createdAt: 6 },
    ],
  }
}

async function manifestOf(file: Blob): Promise<Record<string, unknown>> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const len = new DataView(bytes.buffer).getUint32(MAGIC.length, true)
  const start = MAGIC.length + 4
  return JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + len)))
}

/** Re-encode a file with a modified manifest but the same blob bytes. */
async function withManifest(file: Blob, edit: (m: any) => void): Promise<Blob> {
  const manifest = await manifestOf(file)
  const len = new TextEncoder().encode(JSON.stringify(manifest)).byteLength
  const data = file.slice(MAGIC.length + 4 + len)
  edit(manifest)
  const json = new TextEncoder().encode(JSON.stringify(manifest))
  const header = new Uint8Array(4)
  new DataView(header.buffer).setUint32(0, json.byteLength, true)
  return new Blob([MAGIC, header, json, data])
}

async function expectError(file: Blob, pattern: RegExp) {
  const error = await decodeProject(file).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(ProjectFileError)
  expect((error as Error).message).toMatch(pattern)
}

describe('project file', () => {
  it('round-trips flows, steps and image bytes', async () => {
    const file = encodeProject(sample(), 123)
    const decoded = await decodeProject(file)
    expect(decoded.flows).toEqual(sample().flows)
    expect(decoded.steps).toEqual(sample().steps)
    expect(decoded.blobs.map((b) => b.id)).toEqual(['b1', 'b2'])
    expect(new Uint8Array(await decoded.blobs[1]!.blob.arrayBuffer())).toEqual(JPEG)
    expect(decoded.blobs[0]!.blob.type).toBe('image/png')
  })

  it('rejects files that are not projects', async () => {
    await expectError(new Blob(['hello world, definitely not a project']), /not a ClickFlow/)
    await expectError(new Blob([]), /not a ClickFlow/)
  })

  it('rejects truncated files', async () => {
    const file = encodeProject(sample())
    await expectError(file.slice(0, file.size - 3), /truncated/)
    await expectError(file.slice(0, 30), /truncated|damaged/)
  })

  it('rejects damaged JSON', async () => {
    const header = new Uint8Array(4)
    new DataView(header.buffer).setUint32(0, 5, true)
    await expectError(new Blob([MAGIC, header, '{oops']), /damaged/)
  })

  it('rejects out-of-range annotation coordinates with a readable path', async () => {
    const file = await withManifest(encodeProject(sample()), (m) => {
      m.steps[0].annotations[0].x = 1.5
    })
    await expectError(file, /steps\[0\]\.annotations\[0\]\.x must be a number between 0 and 1/)
  })

  it('rejects annotations that spill outside the screenshot', async () => {
    const file = await withManifest(encodeProject(sample()), (m) => {
      m.steps[0].annotations[0].x = 0.98
    })
    await expectError(file, /inside its screenshot/)
  })

  it('rejects dangling references', async () => {
    const file = await withManifest(encodeProject(sample()), (m) => {
      m.steps[1].screenshotBlobId = 'nope'
    })
    await expectError(file, /has no screenshot/)
  })

  it('rejects images whose bytes do not match their type', async () => {
    const file = await withManifest(encodeProject(sample()), (m) => {
      m.blobs[1].mimeType = 'image/png'
    })
    await expectError(file, /damaged or not supported/)
  })

  it('rejects files from a newer format version', async () => {
    const file = await withManifest(encodeProject(sample()), (m) => {
      m.formatVersion = 99
    })
    await expectError(file, /newer version/)
  })

  it('rejects unknown colors and types', () => {
    const m = JSON.parse(JSON.stringify({ ...sample(), blobs: [] }))
    expect(() => validateManifest(m)).toThrow(ProjectFileError)
  })

  it('drops a thumbnail reference that has no image', async () => {
    const file = await withManifest(encodeProject(sample()), (m) => {
      m.flows[0].thumbnailBlobId = 'gone'
    })
    const decoded = await decodeProject(file)
    expect(decoded.flows[0]!.thumbnailBlobId).toBeUndefined()
  })
})
