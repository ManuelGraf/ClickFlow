// Canvas geometry shared by the on-screen editor and the PNG/thumbnail renderer,
// so the export is laid out exactly like the editor. All values are canvas
// units (CSS px at 100% zoom).

export const LAYOUT = {
  pad: 64,
  /** Space reserved for the flow title above everything else. */
  titleBlock: 76,
  titleSize: 28,
  /** Step number badge + step title line above each card. */
  labelHeight: 48,
  badgeRadius: 14,
  labelSize: 16,
  /** Desktop-window title bar on top of each screenshot. */
  chromeHeight: 28,
  cardRadius: 10,
  gap: 112,
  arrowInset: 16,
  arrowHead: 14,
  descriptionGap: 16,
  descriptionSize: 14,
  descriptionLineHeight: 20,
  descriptionMaxLines: 10,
} as const

export interface ImageSize {
  imageWidth: number
  imageHeight: number
}

export interface CardBox {
  x: number
  /** Top of the step label (badge + title). */
  labelY: number
  /** Top of the card frame (window chrome). */
  y: number
  width: number
  /** Chrome + image. */
  height: number
  imageY: number
  imageHeight: number
}

export interface ArrowBox {
  x1: number
  x2: number
  y: number
}

export interface FlowLayout {
  cards: CardBox[]
  arrows: ArrowBox[]
  /** Full content width including outer padding. */
  width: number
  /** Bottom edge of the tallest card (descriptions extend below this). */
  cardsBottom: number
}

export function displayImageHeight(size: ImageSize, cardWidth: number): number {
  if (size.imageWidth <= 0 || size.imageHeight <= 0) return Math.round(cardWidth * 0.625)
  return Math.round((cardWidth * size.imageHeight) / size.imageWidth)
}

export function computeLayout(steps: readonly ImageSize[], cardWidth: number): FlowLayout {
  const { pad, titleBlock, labelHeight, chromeHeight, gap, arrowInset } = LAYOUT
  const labelY = pad + titleBlock
  const y = labelY + labelHeight

  const cards = steps.map((step, i): CardBox => {
    const imageHeight = displayImageHeight(step, cardWidth)
    return {
      x: pad + i * (cardWidth + gap),
      labelY,
      y,
      width: cardWidth,
      height: chromeHeight + imageHeight,
      imageY: y + chromeHeight,
      imageHeight,
    }
  })

  // Arrows sit at the vertical middle of the shorter of the two screenshots so
  // they always point at both images rather than into empty space.
  const arrows: ArrowBox[] = []
  for (let i = 0; i + 1 < cards.length; i++) {
    const a = cards[i]!
    const b = cards[i + 1]!
    arrows.push({
      x1: a.x + a.width + arrowInset,
      x2: b.x - arrowInset,
      y: a.imageY + Math.min(a.imageHeight, b.imageHeight) / 2,
    })
  }

  const count = Math.max(cards.length, 1)
  return {
    cards,
    arrows,
    width: pad * 2 + count * cardWidth + (count - 1) * gap,
    cardsBottom: cards.reduce((max, c) => Math.max(max, c.y + c.height), y),
  }
}

/**
 * Insertion slot (0..cards.length) for a point at canvas x: the number of cards
 * whose centre lies left of it. Used for drag-reordering and for dropping files
 * between existing cards.
 */
export function slotAt(cards: readonly CardBox[], x: number): number {
  let slot = 0
  for (const card of cards) if (card.x + card.width / 2 < x) slot++
  return slot
}

/** Canvas x of the insertion indicator for a slot. */
export function slotX(cards: readonly CardBox[], slot: number): number {
  if (cards.length === 0) return LAYOUT.pad
  if (slot <= 0) return cards[0]!.x - LAYOUT.gap / 2
  if (slot >= cards.length) {
    const last = cards[cards.length - 1]!
    return last.x + last.width + LAYOUT.gap / 2
  }
  return cards[slot]!.x - LAYOUT.gap / 2
}

/** Visual constants shared by the DOM editor and the canvas renderer. */
export const STYLE = {
  font: '"Open Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
  text: '#1d2127',
  textMuted: '#59616c',
  accent: '#0b7285',
  arrow: '#6b7380',
  arrowWidth: 3,
  cardBorder: '#d5d9df',
  chrome: '#f4f5f7',
  chromeDot: '#cfd3d9',
  workspace: '#eceef1',
  lightGray: '#f1f3f5',
  annotationStroke: 4,
  /** White halo under annotation strokes so they read on dark screenshots too. */
  annotationHalo: 3,
  badgeRadius: 12,
  markerRing: 2.5,
} as const
