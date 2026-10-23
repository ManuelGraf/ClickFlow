import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

export interface View {
  /** Screen offset of the canvas origin, in CSS px. */
  x: number
  y: number
  zoom: number
}

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 3
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Pan/zoom state for a viewport element. Wheel pans (Shift+wheel pans
 * sideways); Ctrl/⌘+wheel and trackpad pinch zoom around the pointer.
 */
export function usePanZoom(viewport: RefObject<HTMLElement | null>) {
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 })
  const viewRef = useRef(view)
  viewRef.current = view

  const size = useCallback(() => {
    const el = viewport.current
    return el ? { width: el.clientWidth, height: el.clientHeight } : { width: 0, height: 0 }
  }, [viewport])

  /** Zoom to `zoom`, keeping the canvas point under `at` (viewport px) fixed. */
  const zoomTo = useCallback(
    (zoom: number, at?: { x: number; y: number }) => {
      setView((v) => {
        const next = clampZoom(zoom)
        const { width, height } = size()
        const p = at ?? { x: width / 2, y: height / 2 }
        const k = next / v.zoom
        return { zoom: next, x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k }
      })
    },
    [size],
  )

  const zoomBy = useCallback(
    (factor: number, at?: { x: number; y: number }) => zoomTo(viewRef.current.zoom * factor, at),
    [zoomTo],
  )

  const panBy = useCallback((dx: number, dy: number) => {
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
  }, [])

  /** Fit the content rectangle into the viewport, never zooming in past `maxZoom`. */
  const fit = useCallback(
    (content: Rect, maxZoom = 1, margin = 32) => {
      const { width, height } = size()
      if (width === 0 || height === 0) return
      const zoom = clampZoom(
        Math.min(
          (width - margin * 2) / content.width,
          (height - margin * 2) / content.height,
          maxZoom,
        ),
      )
      setView({
        zoom,
        x: (width - content.width * zoom) / 2 - content.x * zoom,
        y: Math.max(margin, (height - content.height * zoom) / 2) - content.y * zoom,
      })
    },
    [size],
  )

  /** Pan the minimum needed so a canvas rectangle is on screen. */
  const reveal = useCallback(
    (rect: Rect, margin = 48) => {
      setView((v) => {
        const { width, height } = size()
        const left = rect.x * v.zoom + v.x
        const right = (rect.x + rect.width) * v.zoom + v.x
        const top = rect.y * v.zoom + v.y
        let x = v.x
        let y = v.y
        if (right > width - margin) x -= right - (width - margin)
        if (left + (x - v.x) < margin) x = margin - rect.x * v.zoom
        if (top < margin || top > height - margin) y = margin - rect.y * v.zoom
        return x === v.x && y === v.y ? v : { ...v, x, y }
      })
    },
    [size],
  )

  useEffect(() => {
    const el = viewport.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      // Let scrollable inputs (descriptions) scroll themselves.
      if (e.target instanceof HTMLTextAreaElement && !e.ctrlKey) return
      e.preventDefault()
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1
      const dx = e.deltaX * unit
      const dy = e.deltaY * unit
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect()
        zoomBy(Math.exp(-dy * 0.01), { x: e.clientX - r.left, y: e.clientY - r.top })
      } else if (e.shiftKey && dx === 0) {
        panBy(-dy, 0)
      } else {
        panBy(-dx, -dy)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [viewport, zoomBy, panBy])

  return { view, setView, zoomTo, zoomBy, panBy, fit, reveal, viewRef }
}
