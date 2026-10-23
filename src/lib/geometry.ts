// Annotation box math in normalized screenshot coordinates (0..1 on each axis).
// Pure functions so pointer handling stays thin and this stays testable.

import type { Annotation } from '../types'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
export const CORNER_HANDLES: readonly Handle[] = ['nw', 'ne', 'se', 'sw']
export const ALL_HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export const MIN_SIZE = 0.01

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Fit a box inside the unit square, shrinking it only if it is too large. */
export function clampBox(box: Box, minW = MIN_SIZE, minH = MIN_SIZE): Box {
  const w = clamp(box.w, Math.min(minW, 1), 1)
  const h = clamp(box.h, Math.min(minH, 1), 1)
  return { x: clamp(box.x, 0, 1 - w), y: clamp(box.y, 0, 1 - h), w, h }
}

/** Translate without resizing; stops at the screenshot edges. */
export function moveBox(box: Box, dx: number, dy: number): Box {
  return {
    x: clamp(box.x + dx, 0, 1 - box.w),
    y: clamp(box.y + dy, 0, 1 - box.h),
    w: box.w,
    h: box.h,
  }
}

/** Normalized rectangle spanned by a drag from `a` to `b`, clipped to the image. */
export function boxFromPoints(a: Point, b: Point): Box {
  const x1 = clamp(Math.min(a.x, b.x), 0, 1)
  const y1 = clamp(Math.min(a.y, b.y), 0, 1)
  const x2 = clamp(Math.max(a.x, b.x), 0, 1)
  const y2 = clamp(Math.max(a.y, b.y), 0, 1)
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

/** Box of a given pixel size centred on a point, kept inside the image. */
export function centeredBox(
  center: Point,
  widthPx: number,
  heightPx: number,
  imageWidth: number,
  imageHeight: number,
): Box {
  const w = Math.min(1, widthPx / imageWidth)
  const h = Math.min(1, heightPx / imageHeight)
  return clampBox({ x: center.x - w / 2, y: center.y - h / 2, w, h }, w, h)
}

export interface ResizeOptions {
  minW?: number
  minH?: number
  /**
   * Keep the box square in pixels. Pass the displayed image's width / height;
   * a square box then has h = w * aspect in normalized units.
   */
  squareAspect?: number
}

/**
 * Drag one handle of a box by (dx, dy). The opposite edge(s) stay put, the box
 * never leaves the image, and it never shrinks below the minimum size (dragging
 * past the opposite edge stops there instead of flipping).
 */
export function resizeBox(
  box: Box,
  handle: Handle,
  dx: number,
  dy: number,
  { minW = MIN_SIZE, minH = MIN_SIZE, squareAspect }: ResizeOptions = {},
): Box {
  let left = box.x
  let top = box.y
  let right = box.x + box.w
  let bottom = box.y + box.h

  if (handle.includes('w')) left = clamp(left + dx, 0, right - minW)
  if (handle.includes('e')) right = clamp(right + dx, left + minW, 1)
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - minH)
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + minH, 1)

  if (squareAspect === undefined) return { x: left, y: top, w: right - left, h: bottom - top }

  // Square mode (markers): size follows the width change, anchored at the
  // corner opposite the handle, then shrinks if it would leave the image.
  const anchorX = handle.includes('w') ? box.x + box.w : box.x
  const anchorY = handle.includes('n') ? box.y + box.h : box.y
  const roomX = handle.includes('w') ? anchorX : 1 - anchorX
  const roomY = handle.includes('n') ? anchorY : 1 - anchorY
  let w = Math.max(right - left, minW)
  w = Math.min(w, roomX, roomY / squareAspect)
  const h = w * squareAspect
  return {
    x: handle.includes('w') ? anchorX - w : anchorX,
    y: handle.includes('n') ? anchorY - h : anchorY,
    w,
    h,
  }
}

export function toPixels(box: Box, width: number, height: number): Box {
  return { x: box.x * width, y: box.y * height, w: box.w * width, h: box.h * height }
}

export function fromPixels(box: Box, width: number, height: number): Box {
  return { x: box.x / width, y: box.y / height, w: box.w / width, h: box.h / height }
}

/** Next free badge number on a screenshot (1 if none are numbered yet). */
export function nextNumber(annotations: readonly Annotation[]): number {
  return annotations.reduce((max, a) => Math.max(max, a.number ?? 0), 0) + 1
}

/** Point on an ellipse's rim at the upper-left diagonal, where its badge sits. */
export function badgeAnchor(px: Box): Point {
  const rx = px.w / 2
  const ry = px.h / 2
  return { x: px.x + rx - rx * Math.SQRT1_2, y: px.y + ry - ry * Math.SQRT1_2 }
}
