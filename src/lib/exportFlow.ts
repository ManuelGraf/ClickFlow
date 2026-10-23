import type { ExportSettings, FlowDoc } from '../types'
import { getBlob } from '../db/db'
import { computeExportSize, type ExportSize } from './exportSize'
import { canvasToBlob, drawFlow, loadFonts, measureFlow, type LoadImage } from './render'

/** Decode a stored screenshot straight at the size it will be drawn. */
const loadImage: LoadImage = async (blobId, width, height) => {
  const blob = await getBlob(blobId).catch(() => undefined)
  if (!blob) return null
  try {
    return await createImageBitmap(blob, {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: 'high',
    })
  } catch {
    try {
      return await createImageBitmap(blob)
    } catch {
      return null
    }
  }
}

let measureCtx: CanvasRenderingContext2D | null = null

/** Final PNG dimensions for the given settings (shown before exporting). */
export function exportSizeFor(doc: FlowDoc, scale: number): ExportSize {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  if (!measureCtx) return { width: 0, height: 0, ratio: scale, reduced: false }
  const { width, height } = measureFlow(doc, measureCtx)
  return computeExportSize(width, height, scale)
}

export async function exportFlowPng(doc: FlowDoc, settings: ExportSettings): Promise<Blob> {
  await loadFonts()
  const size = exportSizeFor(doc, settings.scale)
  const canvas = await drawFlow(doc, {
    background: settings.background,
    ratio: size.ratio,
    includeTitle: true,
    loadImage,
  })
  try {
    return await canvasToBlob(canvas, 'image/png')
  } finally {
    // Release the backing store now rather than whenever GC gets to it.
    canvas.width = 0
    canvas.height = 0
  }
}

const THUMB_WIDTH = 480
const THUMB_STEPS = 3

/** Small preview of the first few steps for the library. */
export async function renderThumbnail(doc: FlowDoc): Promise<Blob | null> {
  if (doc.steps.length === 0) return null
  await loadFonts()
  const preview: FlowDoc = { ...doc, steps: doc.steps.slice(0, THUMB_STEPS) }
  measureCtx ??= document.createElement('canvas').getContext('2d')
  if (!measureCtx) return null
  const { width } = measureFlow(preview, measureCtx)
  const ratio = THUMB_WIDTH / width
  const canvas = await drawFlow(preview, {
    background: 'workspace',
    ratio,
    includeTitle: false,
    loadImage,
    maxHeight: (THUMB_WIDTH * 0.625) / ratio,
  })
  try {
    const webp = await canvasToBlob(canvas, 'image/webp', 0.8)
    return webp.type === 'image/webp' ? webp : await canvasToBlob(canvas, 'image/jpeg', 0.85)
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}
