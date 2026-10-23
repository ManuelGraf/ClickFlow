// Portable backup file (.clickflow). One binary file, no base64:
//
//   "CLICKFLOW-PROJECT\n"          magic, 18 ASCII bytes
//   uint32 little-endian           byte length of the manifest
//   manifest                       UTF-8 JSON (flows, steps, blob index)
//   blob data                      raw screenshot/thumbnail bytes, back to back
//
// Writing is a single `new Blob([...])` over the stored blobs, and reading uses
// `File.slice`, so even large backups never need to fit in a string or be
// copied in memory. Everything read from a file is validated before use.

import {
  ANNOTATION_COLORS,
  ANNOTATION_TYPES,
  CARD_WIDTHS,
  EXPORT_BACKGROUNDS,
  type Annotation,
  type BlobRecord,
  type Flow,
  type Step,
} from '../types'
import { ACCEPTED_TYPES, sniffBlob } from '../lib/images'
import type { ProjectData } from './db'

export const MAGIC = 'CLICKFLOW-PROJECT\n'
export const FORMAT = 'clickflow-project'
export const FORMAT_VERSION = 1
export const FILE_EXTENSION = 'clickflow'
const HEADER_BYTES = MAGIC.length + 4
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024

interface BlobEntry {
  id: string
  mimeType: string
  createdAt: number
  offset: number
  length: number
}

export interface Manifest {
  format: typeof FORMAT
  formatVersion: number
  exportedAt: number
  flows: Flow[]
  steps: Step[]
  blobs: BlobEntry[]
}

export class ProjectFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectFileError'
  }
}

// ---------------------------------------------------------------- write

export function encodeProject(data: ProjectData, now = Date.now()): Blob {
  let offset = 0
  const blobs: BlobEntry[] = data.blobs.map((b) => {
    const entry = {
      id: b.id,
      mimeType: b.mimeType,
      createdAt: b.createdAt,
      offset,
      length: b.blob.size,
    }
    offset += b.blob.size
    return entry
  })
  const manifest: Manifest = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    exportedAt: now,
    flows: data.flows,
    steps: data.steps,
    blobs,
  }
  const json = new TextEncoder().encode(JSON.stringify(manifest))
  const length = new Uint8Array(4)
  new DataView(length.buffer).setUint32(0, json.byteLength, true)
  return new Blob([MAGIC, length, json, ...data.blobs.map((b) => b.blob)], {
    type: 'application/octet-stream',
  })
}

// ---------------------------------------------------------------- read

/**
 * Parse and fully validate a backup file. Throws ProjectFileError with a
 * message suitable for showing to the user.
 */
export async function decodeProject(file: Blob): Promise<ProjectData> {
  if (file.size < HEADER_BYTES) throw new ProjectFileError(NOT_A_PROJECT)
  const header = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer())
  if (new TextDecoder().decode(header.subarray(0, MAGIC.length)) !== MAGIC) {
    throw new ProjectFileError(NOT_A_PROJECT)
  }
  const manifestBytes = new DataView(header.buffer, header.byteOffset).getUint32(MAGIC.length, true)
  if (manifestBytes > MAX_MANIFEST_BYTES || HEADER_BYTES + manifestBytes > file.size) {
    throw new ProjectFileError('The project file is truncated or damaged.')
  }

  let json: unknown
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(
      await file.slice(HEADER_BYTES, HEADER_BYTES + manifestBytes).arrayBuffer(),
    )
    json = JSON.parse(text)
  } catch {
    throw new ProjectFileError('The project file is damaged: its contents could not be read.')
  }

  const manifest = validateManifest(json)
  const dataStart = HEADER_BYTES + manifestBytes
  const dataSize = file.size - dataStart

  const blobs: BlobRecord[] = []
  for (const entry of manifest.blobs) {
    if (entry.offset + entry.length > dataSize) {
      throw new ProjectFileError('The project file is truncated: some images are missing.')
    }
    const start = dataStart + entry.offset
    const blob = file.slice(start, start + entry.length, entry.mimeType)
    const actual = await sniffBlob(blob)
    if (actual !== entry.mimeType) {
      throw new ProjectFileError(
        'The project file contains an image that is damaged or not supported.',
      )
    }
    blobs.push({ id: entry.id, mimeType: entry.mimeType, createdAt: entry.createdAt, blob })
  }
  return { flows: manifest.flows, steps: manifest.steps, blobs }
}

const NOT_A_PROJECT = 'This is not a ClickFlow project file.'

// ---------------------------------------------------------------- validation

class Invalid extends Error {}

function fail(path: string, expected: string): never {
  throw new Invalid(`${path} ${expected}`)
}

type Obj = Record<string, unknown>

function obj(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'must be an object')
  return v as Obj
}
function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail(path, 'must be a list')
  return v
}
function str(v: unknown, path: string, max = 10_000): string {
  if (typeof v !== 'string' || v.length > max) fail(path, 'must be text')
  return v
}
function id(v: unknown, path: string): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 100) fail(path, 'must be an id')
  return v
}
function num(v: unknown, path: string, min = -Infinity, max = Infinity): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    fail(path, `must be a number between ${min} and ${max}`)
  }
  return v
}
function int(v: unknown, path: string, min: number, max: number): number {
  const n = num(v, path, min, max)
  if (!Number.isInteger(n)) fail(path, 'must be a whole number')
  return n
}
function oneOf<T extends string | number>(v: unknown, options: readonly T[], path: string): T {
  if (!options.includes(v as T)) fail(path, `must be one of ${options.join(', ')}`)
  return v as T
}

const EPS = 1e-6

function annotation(v: unknown, path: string): Annotation {
  const o = obj(v, path)
  const a: Annotation = {
    id: id(o.id, `${path}.id`),
    type: oneOf(o.type, ANNOTATION_TYPES, `${path}.type`),
    x: num(o.x, `${path}.x`, 0, 1),
    y: num(o.y, `${path}.y`, 0, 1),
    w: num(o.w, `${path}.w`, 0, 1),
    h: num(o.h, `${path}.h`, 0, 1),
    color: oneOf(o.color, ANNOTATION_COLORS, `${path}.color`),
  }
  if (a.x + a.w > 1 + EPS || a.y + a.h > 1 + EPS) fail(path, 'must lie inside its screenshot')
  if (o.number !== undefined) a.number = int(o.number, `${path}.number`, 1, 999)
  return a
}

function step(v: unknown, path: string): Step {
  const o = obj(v, path)
  return {
    id: id(o.id, `${path}.id`),
    flowId: id(o.flowId, `${path}.flowId`),
    screenshotBlobId: id(o.screenshotBlobId, `${path}.screenshotBlobId`),
    order: int(o.order, `${path}.order`, 0, 100_000),
    title: str(o.title, `${path}.title`, 500),
    description: str(o.description, `${path}.description`),
    imageWidth: int(o.imageWidth, `${path}.imageWidth`, 1, 100_000),
    imageHeight: int(o.imageHeight, `${path}.imageHeight`, 1, 100_000),
    annotations: arr(o.annotations, `${path}.annotations`).map((a, i) =>
      annotation(a, `${path}.annotations[${i}]`),
    ),
  }
}

function flow(v: unknown, path: string): Flow {
  const o = obj(v, path)
  const canvas = obj(o.canvas, `${path}.canvas`)
  const exp = obj(o.export, `${path}.export`)
  const f: Flow = {
    id: id(o.id, `${path}.id`),
    title: str(o.title, `${path}.title`, 500),
    createdAt: num(o.createdAt, `${path}.createdAt`, 0),
    updatedAt: num(o.updatedAt, `${path}.updatedAt`, 0),
    stepIds: arr(o.stepIds, `${path}.stepIds`).map((s, i) => id(s, `${path}.stepIds[${i}]`)),
    canvas: { cardWidth: oneOf(canvas.cardWidth, CARD_WIDTHS, `${path}.canvas.cardWidth`) },
    export: {
      scale: oneOf(exp.scale, [1, 2] as const, `${path}.export.scale`),
      background: oneOf(exp.background, EXPORT_BACKGROUNDS, `${path}.export.background`),
    },
  }
  if (o.thumbnailBlobId !== undefined)
    f.thumbnailBlobId = id(o.thumbnailBlobId, `${path}.thumbnailBlobId`)
  return f
}

function blobEntry(v: unknown, path: string): BlobEntry {
  const o = obj(v, path)
  return {
    id: id(o.id, `${path}.id`),
    mimeType: oneOf(o.mimeType, ACCEPTED_TYPES, `${path}.mimeType`),
    createdAt: num(o.createdAt, `${path}.createdAt`, 0),
    offset: int(o.offset, `${path}.offset`, 0, Number.MAX_SAFE_INTEGER),
    length: int(o.length, `${path}.length`, 1, Number.MAX_SAFE_INTEGER),
  }
}

function unique(ids: string[], what: string) {
  if (new Set(ids).size !== ids.length) throw new Invalid(`${what} ids are not unique`)
}

/**
 * Check shape, value ranges and cross-references of a parsed manifest.
 * Older format versions would be migrated here before validation.
 */
export function validateManifest(json: unknown): Manifest {
  try {
    const o = obj(json, 'file')
    if (o.format !== FORMAT) throw new ProjectFileError(NOT_A_PROJECT)
    const version = int(o.formatVersion, 'formatVersion', 1, Number.MAX_SAFE_INTEGER)
    if (version > FORMAT_VERSION) {
      throw new ProjectFileError(
        'This project file was made by a newer version of ClickFlow. Reload the app to update it, then try again.',
      )
    }
    const manifest: Manifest = {
      format: FORMAT,
      formatVersion: version,
      exportedAt: num(o.exportedAt, 'exportedAt', 0),
      flows: arr(o.flows, 'flows').map((f, i) => flow(f, `flows[${i}]`)),
      steps: arr(o.steps, 'steps').map((s, i) => step(s, `steps[${i}]`)),
      blobs: arr(o.blobs, 'blobs').map((b, i) => blobEntry(b, `blobs[${i}]`)),
    }
    if (manifest.flows.length === 0)
      throw new ProjectFileError('The project file contains no flows.')

    unique(
      manifest.flows.map((f) => f.id),
      'Flow',
    )
    unique(
      manifest.steps.map((s) => s.id),
      'Step',
    )
    unique(
      manifest.blobs.map((b) => b.id),
      'Image',
    )

    const blobIds = new Set(manifest.blobs.map((b) => b.id))
    const stepsById = new Map(manifest.steps.map((s) => [s.id, s]))
    const flowIds = new Set(manifest.flows.map((f) => f.id))
    for (const s of manifest.steps) {
      if (!flowIds.has(s.flowId)) throw new Invalid(`step ${s.id} belongs to an unknown flow`)
      if (!blobIds.has(s.screenshotBlobId)) throw new Invalid(`step ${s.id} has no screenshot`)
    }
    for (const f of manifest.flows) {
      for (const sid of f.stepIds) {
        if (stepsById.get(sid)?.flowId !== f.id)
          throw new Invalid(`flow ${f.id} lists an unknown step`)
      }
      if (f.thumbnailBlobId && !blobIds.has(f.thumbnailBlobId)) delete f.thumbnailBlobId
    }
    const listed = manifest.flows.reduce((n, f) => n + f.stepIds.length, 0)
    if (listed !== manifest.steps.length) throw new Invalid('some steps are not part of any flow')
    return manifest
  } catch (e) {
    if (e instanceof Invalid) {
      throw new ProjectFileError(`The project file is not valid: ${e.message}.`)
    }
    throw e
  }
}
