import { describe, expect, it } from 'vitest'
import {
  badgeAnchor,
  boxFromPoints,
  centeredBox,
  clampBox,
  fromPixels,
  moveBox,
  nextNumber,
  resizeBox,
  toPixels,
} from './geometry'
import type { Annotation } from '../types'

const close = (a: object, b: Record<string, number>) => {
  for (const k of Object.keys(b)) expect((a as Record<string, number>)[k]).toBeCloseTo(b[k]!, 9)
}

describe('normalized coordinates', () => {
  it('map to the same relative position at any display size', () => {
    const box = { x: 0.25, y: 0.5, w: 0.1, h: 0.2 }
    const small = toPixels(box, 640, 400)
    const large = toPixels(box, 1280, 800)
    expect(small).toEqual({ x: 160, y: 200, w: 64, h: 80 })
    expect(large).toEqual({ x: 320, y: 400, w: 128, h: 160 })
    close(fromPixels(large, 1280, 800), box)
  })
})

describe('clampBox / moveBox', () => {
  it('keeps boxes inside the image', () => {
    expect(clampBox({ x: 0.95, y: -0.2, w: 0.2, h: 0.3 })).toEqual({ x: 0.8, y: 0, w: 0.2, h: 0.3 })
    expect(clampBox({ x: 0, y: 0, w: 2, h: 0 }).w).toBe(1)
    expect(clampBox({ x: 0, y: 0, w: 0.5, h: 0 }).h).toBeGreaterThan(0)
  })

  it('moves without resizing and stops at edges', () => {
    const box = { x: 0.7, y: 0.1, w: 0.2, h: 0.2 }
    close(moveBox(box, 0.5, -0.5), { x: 0.8, y: 0, w: 0.2, h: 0.2 })
  })
})

describe('boxFromPoints', () => {
  it('normalizes drag direction and clips to the image', () => {
    close(boxFromPoints({ x: 0.6, y: 0.8 }, { x: 0.2, y: 1.4 }), { x: 0.2, y: 0.8, w: 0.4, h: 0.2 })
  })
})

describe('centeredBox', () => {
  it('centres a pixel-sized box and shifts it inside near edges', () => {
    const box = centeredBox({ x: 0.5, y: 0.5 }, 64, 40, 640, 400)
    close(box, { x: 0.45, y: 0.45, w: 0.1, h: 0.1 })
    const edge = centeredBox({ x: 0, y: 1 }, 64, 40, 640, 400)
    close(edge, { x: 0, y: 0.9, w: 0.1, h: 0.1 })
  })
})

describe('resizeBox', () => {
  const box = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 }

  it('moves only the dragged edges', () => {
    close(resizeBox(box, 'se', 0.1, 0.1), { x: 0.2, y: 0.2, w: 0.5, h: 0.5 })
    close(resizeBox(box, 'nw', 0.1, -0.1), { x: 0.3, y: 0.1, w: 0.3, h: 0.5 })
    close(resizeBox(box, 'e', 0.1, 0.3), { x: 0.2, y: 0.2, w: 0.5, h: 0.4 })
    close(resizeBox(box, 'n', 0.3, 0.1), { x: 0.2, y: 0.3, w: 0.4, h: 0.3 })
  })

  it('never flips or shrinks below the minimum', () => {
    const r = resizeBox(box, 'w', 0.9, 0, { minW: 0.05 })
    close(r, { x: 0.55, w: 0.05 })
  })

  it('clips to the image', () => {
    close(resizeBox(box, 'se', 2, 2), { x: 0.2, y: 0.2, w: 0.8, h: 0.8 })
  })

  it('keeps markers square in pixels', () => {
    // 16:10 image: a pixel-square box has h = w * 1.6 in normalized units.
    const marker = { x: 0.5, y: 0.5, w: 0.05, h: 0.08 }
    const r = resizeBox(marker, 'se', 0.05, 0, { squareAspect: 1.6 })
    close(r, { x: 0.5, y: 0.5, w: 0.1, h: 0.16 })
    const nw = resizeBox(marker, 'nw', -0.05, 0, { squareAspect: 1.6 })
    close(nw, { x: 0.45, y: 0.5 + 0.08 - 0.16, w: 0.1, h: 0.16 })
  })

  it('shrinks a square box that would leave the image', () => {
    const marker = { x: 0.8, y: 0.9, w: 0.05, h: 0.05 }
    const r = resizeBox(marker, 'se', 0.15, 0, { squareAspect: 1 })
    close(r, { x: 0.8, y: 0.9, w: 0.1, h: 0.1 })
  })
})

describe('numbers and badges', () => {
  it('picks the next free number', () => {
    const a = (n?: number): Annotation => ({
      id: String(n),
      type: 'ellipse',
      x: 0,
      y: 0,
      w: 0.1,
      h: 0.1,
      color: 'red',
      ...(n === undefined ? {} : { number: n }),
    })
    expect(nextNumber([])).toBe(1)
    expect(nextNumber([a(), a(2), a(5)])).toBe(6)
  })

  it('anchors badges on the ellipse rim', () => {
    const p = badgeAnchor({ x: 0, y: 0, w: 200, h: 100 })
    // (x - cx)^2 / rx^2 + (y - cy)^2 / ry^2 === 1
    expect(((p.x - 100) / 100) ** 2 + ((p.y - 50) / 50) ** 2).toBeCloseTo(1)
  })
})
