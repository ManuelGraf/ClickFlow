// Domain model. Everything here is plain, structured-cloneable data: it is what
// IndexedDB stores (apart from the Blob in BlobRecord) and what the undo history
// snapshots. Screenshot pixels are never inlined — steps reference blobs by id.

export const ANNOTATION_COLORS = ['red', 'orange', 'blue', 'green'] as const
export type AnnotationColor = (typeof ANNOTATION_COLORS)[number]

export const ANNOTATION_TYPES = ['ellipse', 'marker'] as const
export type AnnotationType = (typeof ANNOTATION_TYPES)[number]

/**
 * A highlight on a screenshot. The box is normalized to the screenshot: 0..1 of
 * its width (x, w) and height (y, h), measured from the top-left corner. That
 * keeps annotations anchored whatever size the card is drawn at.
 *
 * - `ellipse` fills the box; `number` optionally adds a badge on its rim.
 * - `marker` is a numbered dot inscribed in the box (always has a number).
 */
export interface Annotation {
  id: string
  type: AnnotationType
  x: number
  y: number
  w: number
  h: number
  color: AnnotationColor
  number?: number
}

export interface Step {
  id: string
  flowId: string
  screenshotBlobId: string
  /** Position in the flow, 0-based. Mirrors the index in Flow.stepIds. */
  order: number
  title: string
  description: string
  /** Pixel size of the stored screenshot (after any import downscaling). */
  imageWidth: number
  imageHeight: number
  annotations: Annotation[]
}

export const CARD_WIDTHS = [480, 640, 800] as const
export type CardWidth = (typeof CARD_WIDTHS)[number]

export interface CanvasSettings {
  /** Display width of every screenshot card, in canvas units. */
  cardWidth: CardWidth
}

export const EXPORT_BACKGROUNDS = ['white', 'light-gray', 'transparent'] as const
export type ExportBackground = (typeof EXPORT_BACKGROUNDS)[number]
export type ExportScale = 1 | 2

export interface ExportSettings {
  scale: ExportScale
  background: ExportBackground
}

export interface Flow {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  stepIds: string[]
  canvas: CanvasSettings
  export: ExportSettings
  thumbnailBlobId?: string
}

export interface BlobRecord {
  id: string
  mimeType: string
  blob: Blob
  createdAt: number
}

/** A flow together with its ordered steps — the unit the editor works on. */
export interface FlowDoc {
  flow: Flow
  steps: Step[]
}

export const DEFAULT_CANVAS: CanvasSettings = { cardWidth: 640 }
export const DEFAULT_EXPORT: ExportSettings = { scale: 2, background: 'white' }

export const COLOR_HEX: Record<AnnotationColor, string> = {
  red: '#e03131',
  orange: '#f76707',
  blue: '#1c7ed6',
  green: '#2f9e44',
}
