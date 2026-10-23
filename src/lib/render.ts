// Draws a flow onto a <canvas> for PNG export and library thumbnails, using the
// same layout as the on-screen editor. Screenshots come from IndexedDB blobs
// decoded with createImageBitmap — same-origin data, so the canvas is never
// tainted — and each bitmap is closed right after it is drawn to keep memory
// flat for long flows.

import { COLOR_HEX, type Annotation, type ExportBackground, type FlowDoc } from '../types'
import { badgeAnchor, toPixels } from './geometry'
import {
  computeLayout,
  LAYOUT,
  STYLE,
  type ArrowBox,
  type CardBox,
  type FlowLayout,
} from './layout'
import { truncate, wrapText } from './text'

export type LoadImage = (
  blobId: string,
  width: number,
  height: number,
) => Promise<ImageBitmap | null>

export interface FlowMeasure {
  layout: FlowLayout
  descriptions: string[][]
  width: number
  height: number
}

const font = (weight: number, size: number) => `${weight} ${size}px ${STYLE.font}`

/** Wait for the self-hosted fonts so canvas text matches the editor. */
export async function loadFonts(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load(font(600, LAYOUT.titleSize)),
      document.fonts.load(font(400, LAYOUT.descriptionSize)),
      document.fonts.load(font(700, 13)),
    ])
  } catch {
    // Falls back to system fonts.
  }
}

/** Overall size of the drawing, including wrapped descriptions. */
export function measureFlow(doc: FlowDoc, ctx: CanvasRenderingContext2D): FlowMeasure {
  const layout = computeLayout(doc.steps, doc.flow.canvas.cardWidth)
  ctx.font = font(400, LAYOUT.descriptionSize)
  const descriptions = doc.steps.map((s) =>
    s.description.trim()
      ? wrapText(
          s.description.trim(),
          doc.flow.canvas.cardWidth,
          (t) => ctx.measureText(t).width,
          LAYOUT.descriptionMaxLines,
        )
      : [],
  )
  const lines = Math.max(0, ...descriptions.map((d) => d.length))
  const descHeight = lines > 0 ? LAYOUT.descriptionGap + lines * LAYOUT.descriptionLineHeight : 0
  return {
    layout,
    descriptions,
    width: layout.width,
    height: layout.cardsBottom + descHeight + LAYOUT.pad,
  }
}

export interface DrawOptions {
  background: ExportBackground | 'workspace'
  /** Canvas pixels per canvas unit. */
  ratio: number
  /** Thumbnails skip the title row. */
  includeTitle: boolean
  loadImage: LoadImage
  /** Optional clip height in canvas units (thumbnails). */
  maxHeight?: number
}

const BACKGROUNDS: Record<Exclude<DrawOptions['background'], 'transparent'>, string> = {
  white: '#ffffff',
  'light-gray': STYLE.lightGray,
  workspace: STYLE.workspace,
}

export async function drawFlow(doc: FlowDoc, options: DrawOptions): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available in this browser.')
  const measure = measureFlow(doc, ctx)
  const top = options.includeTitle ? 0 : LAYOUT.titleBlock
  const height = Math.min(measure.height - top, options.maxHeight ?? Infinity)

  canvas.width = Math.max(1, Math.floor(measure.width * options.ratio))
  canvas.height = Math.max(1, Math.floor(height * options.ratio))
  ctx.scale(options.ratio, options.ratio)
  ctx.translate(0, -top)

  if (options.background !== 'transparent') {
    ctx.fillStyle = BACKGROUNDS[options.background]
    ctx.fillRect(0, top, measure.width, height)
  }

  if (options.includeTitle) {
    ctx.fillStyle = STYLE.text
    ctx.font = font(600, LAYOUT.titleSize)
    ctx.textBaseline = 'middle'
    ctx.fillText(
      truncate(
        doc.flow.title || 'Untitled flow',
        measure.width - LAYOUT.pad * 2,
        (t) => ctx.measureText(t).width,
      ),
      LAYOUT.pad,
      LAYOUT.pad + 20,
    )
  }

  for (const arrow of measure.layout.arrows) drawArrow(ctx, arrow)

  const { cards } = measure.layout
  for (let i = 0; i < doc.steps.length; i++) {
    const step = doc.steps[i]!
    const card = cards[i]!
    drawLabel(ctx, card, i + 1, step.title)
    const pixelWidth = Math.ceil(card.width * options.ratio)
    const pixelHeight = Math.ceil(card.imageHeight * options.ratio)
    const bitmap = await options.loadImage(step.screenshotBlobId, pixelWidth, pixelHeight)
    try {
      drawCard(ctx, card, bitmap)
    } finally {
      bitmap?.close()
    }
    for (const a of step.annotations) {
      drawAnnotation(ctx, a, { x: card.x, y: card.imageY, w: card.width, h: card.imageHeight })
    }
    drawDescription(ctx, card, measure.descriptions[i] ?? [])
  }
  return canvas
}

function drawArrow(ctx: CanvasRenderingContext2D, a: ArrowBox) {
  const head = LAYOUT.arrowHead
  ctx.strokeStyle = STYLE.arrow
  ctx.fillStyle = STYLE.arrow
  ctx.lineWidth = STYLE.arrowWidth
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(a.x1, a.y)
  ctx.lineTo(a.x2 - head + 2, a.y)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(a.x2, a.y)
  ctx.lineTo(a.x2 - head, a.y - head * 0.6)
  ctx.lineTo(a.x2 - head, a.y + head * 0.6)
  ctx.closePath()
  ctx.fill()
}

function drawLabel(ctx: CanvasRenderingContext2D, card: CardBox, number: number, title: string) {
  const r = LAYOUT.badgeRadius
  const cy = card.labelY + 18
  ctx.fillStyle = STYLE.accent
  ctx.beginPath()
  ctx.arc(card.x + r, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = font(700, 13)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(number), card.x + r, cy + 0.5)
  ctx.textAlign = 'left'
  if (title.trim()) {
    ctx.fillStyle = STYLE.text
    ctx.font = font(600, LAYOUT.labelSize)
    const maxWidth = card.width - r * 2 - 10
    ctx.fillText(
      truncate(title.trim(), maxWidth, (t) => ctx.measureText(t).width),
      card.x + r * 2 + 10,
      cy,
    )
  }
}

function drawCard(ctx: CanvasRenderingContext2D, card: CardBox, bitmap: ImageBitmap | null) {
  const radius = LAYOUT.cardRadius
  const chrome = LAYOUT.chromeHeight

  ctx.save()
  ctx.shadowColor = 'rgba(16, 24, 40, 0.10)'
  ctx.shadowBlur = 18
  ctx.shadowOffsetY = 4
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.roundRect(card.x, card.y, card.width, card.height, radius)
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.beginPath()
  ctx.roundRect(card.x, card.y, card.width, card.height, radius)
  ctx.clip()
  ctx.fillStyle = STYLE.chrome
  ctx.fillRect(card.x, card.y, card.width, chrome)
  ctx.fillStyle = STYLE.chromeDot
  for (let d = 0; d < 3; d++) {
    ctx.beginPath()
    ctx.arc(card.x + 16 + d * 14, card.y + chrome / 2, 4, 0, Math.PI * 2)
    ctx.fill()
  }
  if (bitmap) {
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, card.x, card.imageY, card.width, card.imageHeight)
  } else {
    ctx.fillStyle = '#e9ecef'
    ctx.fillRect(card.x, card.imageY, card.width, card.imageHeight)
    ctx.fillStyle = STYLE.textMuted
    ctx.font = font(400, 14)
    ctx.textAlign = 'center'
    ctx.fillText('Screenshot missing', card.x + card.width / 2, card.imageY + card.imageHeight / 2)
    ctx.textAlign = 'left'
  }
  ctx.restore()

  ctx.strokeStyle = STYLE.cardBorder
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(card.x, card.imageY - 0.5)
  ctx.lineTo(card.x + card.width, card.imageY - 0.5)
  ctx.stroke()
  ctx.beginPath()
  ctx.roundRect(card.x + 0.5, card.y + 0.5, card.width - 1, card.height - 1, radius)
  ctx.stroke()
}

export function drawAnnotation(
  ctx: CanvasRenderingContext2D,
  a: Annotation,
  image: { x: number; y: number; w: number; h: number },
) {
  const px = toPixels(a, image.w, image.h)
  px.x += image.x
  px.y += image.y
  const color = COLOR_HEX[a.color]
  const cx = px.x + px.w / 2
  const cy = px.y + px.h / 2

  if (a.type === 'marker') {
    const r = Math.min(px.w, px.h) / 2
    drawBadge(ctx, cx, cy, r, color, a.number ?? 1, STYLE.markerRing)
    return
  }

  ctx.beginPath()
  ctx.ellipse(cx, cy, Math.max(px.w / 2, 1), Math.max(px.h / 2, 1), 0, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
  ctx.lineWidth = STYLE.annotationStroke + STYLE.annotationHalo * 2
  ctx.stroke()
  ctx.strokeStyle = color
  ctx.lineWidth = STYLE.annotationStroke
  ctx.stroke()
  if (a.number !== undefined) {
    const p = badgeAnchor(px)
    drawBadge(ctx, p.x, p.y, STYLE.badgeRadius, color, a.number, 2)
  }
}

function drawBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  number: number,
  ring: number,
) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = ring
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.font = font(700, Math.max(9, Math.round(r * 1.05)))
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(number), x, y + r * 0.04)
  ctx.textAlign = 'left'
}

function drawDescription(ctx: CanvasRenderingContext2D, card: CardBox, lines: string[]) {
  if (lines.length === 0) return
  ctx.fillStyle = STYLE.textMuted
  ctx.font = font(400, LAYOUT.descriptionSize)
  ctx.textBaseline = 'middle'
  const top = card.y + card.height + LAYOUT.descriptionGap
  lines.forEach((line, i) => {
    ctx.fillText(
      line,
      card.x,
      top + i * LAYOUT.descriptionLineHeight + LAYOUT.descriptionLineHeight / 2,
    )
  })
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error('The browser could not encode the image. Try the 1× size.')),
      type,
      quality,
    ),
  )
}
