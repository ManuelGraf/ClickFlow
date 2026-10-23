// Screenshot import: validate by content (not file name), measure, and
// downscale / re-encode unusually large images before they reach IndexedDB.

export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export type AcceptedType = (typeof ACCEPTED_TYPES)[number]
export const ACCEPT_ATTR = ACCEPTED_TYPES.join(',')

/** Detect PNG / JPEG / WebP from the first bytes of a file. */
export function sniffImageType(bytes: Uint8Array): AcceptedType | null {
  const at = (i: number) => bytes[i] ?? -1
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png'
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg'
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...Array.from(bytes.subarray(from, to)))
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  return null
}

export async function sniffBlob(blob: Blob): Promise<AcceptedType | null> {
  return sniffImageType(new Uint8Array(await blob.slice(0, 16).arrayBuffer()))
}

/** Screenshots wider than this are downscaled (2× a 1440px desktop). */
export const MAX_IMAGE_WIDTH = 2880
/** Total pixel budget, so tall full-page captures are bounded too. */
export const MAX_IMAGE_PIXELS = 2880 * 6000
/** Keeps extreme full-page captures within every browser's canvas limits. */
export const MAX_IMAGE_HEIGHT = 16_000
/** Files above this size are re-encoded even if their dimensions are fine. */
export const REENCODE_BYTES = 3 * 1024 * 1024

export interface ImportPlan {
  width: number
  height: number
  /** True when the stored image should be a resized/re-encoded copy. */
  reencode: boolean
}

export function planImport(width: number, height: number, bytes: number): ImportPlan {
  const scale = Math.min(
    1,
    MAX_IMAGE_WIDTH / width,
    MAX_IMAGE_HEIGHT / height,
    Math.sqrt(MAX_IMAGE_PIXELS / (width * height)),
  )
  if (scale < 1) {
    return {
      width: Math.max(1, Math.floor(width * scale)),
      height: Math.max(1, Math.floor(height * scale)),
      reencode: true,
    }
  }
  return { width, height, reencode: bytes > REENCODE_BYTES }
}

export interface PreparedImage {
  blob: Blob
  mimeType: string
  width: number
  height: number
  /** True when the stored copy is smaller than the original. */
  downscaled: boolean
}

export class ImageImportError extends Error {}

/**
 * Turn a dropped/pasted/picked file into what gets stored. Never uploads
 * anything; decoding happens in memory and the bitmap is released afterwards.
 */
export async function prepareImage(file: Blob, name = 'image'): Promise<PreparedImage> {
  const type = await sniffBlob(file)
  if (!type) throw new ImageImportError(`${name} is not a PNG, JPEG or WebP image.`)

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new ImageImportError(`${name} could not be decoded. The file may be damaged.`)
  }
  try {
    const plan = planImport(bitmap.width, bitmap.height, file.size)
    if (!plan.reencode) {
      return {
        blob: file,
        mimeType: type,
        width: bitmap.width,
        height: bitmap.height,
        downscaled: false,
      }
    }
    const encoded = await encodeBitmap(bitmap, plan.width, plan.height)
    const resized = plan.width !== bitmap.width
    // A re-encode that did not resize and did not save space is pointless.
    if (!encoded || (!resized && encoded.size >= file.size)) {
      return {
        blob: file,
        mimeType: type,
        width: bitmap.width,
        height: bitmap.height,
        downscaled: false,
      }
    }
    return {
      blob: encoded,
      mimeType: encoded.type,
      width: plan.width,
      height: plan.height,
      downscaled: true,
    }
  } finally {
    bitmap.close()
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
}

/**
 * Draw at the target size and encode as WebP, falling back to JPEG on
 * browsers that cannot encode WebP (they silently return PNG instead).
 */
export async function encodeBitmap(
  source: CanvasImageSource,
  width: number,
  height: number,
  quality = 0.9,
): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, width, height)
  const webp = await canvasToBlob(canvas, 'image/webp', quality)
  if (webp?.type === 'image/webp') return webp
  // JPEG has no alpha; flatten onto white so transparent areas don't go black.
  ctx.globalCompositeOperation = 'destination-over'
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  return canvasToBlob(canvas, 'image/jpeg', quality)
}

/** Image files from a DataTransfer (drop or paste), in their given order. */
export function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return []
  const files = Array.from(data.files)
  if (files.length > 0) return files.filter((f) => f.type.startsWith('image/') || f.type === '')
  // Some browsers expose pasted screenshots only through items.
  return Array.from(data.items)
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((f): f is File => f !== null)
}

export function hasFiles(data: DataTransfer | null): boolean {
  return !!data && Array.from(data.types).includes('Files')
}
