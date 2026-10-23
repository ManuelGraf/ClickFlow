import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { COLOR_HEX, type Annotation, type Step } from '../types'
import {
  ALL_HANDLES,
  CORNER_HANDLES,
  badgeAnchor,
  boxFromPoints,
  centeredBox,
  moveBox,
  nextNumber,
  resizeBox,
  toPixels,
  type Box,
  type Handle,
  type Point,
} from '../lib/geometry'
import { STYLE } from '../lib/layout'
import { newId } from '../lib/ids'
import type { ToolState } from './editorTypes'

interface AnnotationLayerProps {
  step: Step
  /** Displayed image size in canvas units. */
  width: number
  height: number
  zoom: number
  tools: ToolState
  selectedId: string | null
  /** Select an annotation, or just the step when null. */
  onSelect: (annotationId: string | null) => void
  onCreate: (annotation: Annotation) => void
  onChange: (annotationId: string, box: Box) => void
}

type Drag =
  | { kind: 'draw'; start: Point }
  | { kind: 'move'; id: string; start: Point; box: Box }
  | { kind: 'resize'; id: string; handle: Handle; start: Point; box: Box; square?: number }

type Draft = { id: string | null; box: Box }

/** Marker diameter, in canvas units, when placed. */
export const MARKER_SIZE = 32
/** A drag shorter than this (screen px) counts as a click. */
const CLICK_SLOP = 6

const HANDLE_CURSOR: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
}

function handlePoint(px: Box, h: Handle): Point {
  const x = h.includes('w') ? px.x : h.includes('e') ? px.x + px.w : px.x + px.w / 2
  const y = h.includes('n') ? px.y : h.includes('s') ? px.y + px.h : px.y + px.h / 2
  return { x, y }
}

const sameBox = (a: Box, b: Box) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

/**
 * SVG overlay on one screenshot: draws annotations and turns pointer input into
 * create / move / resize edits. While dragging, edits live in a local draft so
 * the whole gesture becomes a single undo step when the pointer is released.
 */
export function AnnotationLayer({
  step,
  width,
  height,
  zoom,
  tools,
  selectedId,
  onSelect,
  onCreate,
  onChange,
}: AnnotationLayerProps) {
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag | null>(null)
  const [draft, setDraftState] = useState<Draft | null>(null)
  // Mirrored in a ref: pointerup must see the last move even if React has not
  // re-rendered in between.
  const draftRef = useRef<Draft | null>(null)
  const setDraft = (d: Draft | null) => {
    draftRef.current = d
    setDraftState(d)
  }

  const toNormalized = (e: { clientX: number; clientY: number }): Point => {
    const r = svg.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }

  const begin = (e: ReactPointerEvent, next: Drag) => {
    e.stopPropagation()
    e.preventDefault()
    svg.current?.setPointerCapture(e.pointerId)
    drag.current = next
  }

  const onBackgroundDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || tools.tool === 'select') return // bubbles up: selects the step
    const p = toNormalized(e)
    if (tools.tool === 'marker') {
      e.stopPropagation()
      const box = centeredBox(p, MARKER_SIZE, MARKER_SIZE, width, height)
      onCreate({
        id: newId(),
        type: 'marker',
        ...box,
        color: tools.color,
        number: nextNumber(step.annotations),
      })
      return
    }
    onSelect(null)
    begin(e, { kind: 'draw', start: p })
    setDraft({ id: null, box: { ...p, w: 0, h: 0 } })
  }

  const onShapeDown = (e: ReactPointerEvent, a: Annotation) => {
    if (e.button !== 0) return
    onSelect(a.id)
    begin(e, {
      kind: 'move',
      id: a.id,
      start: toNormalized(e),
      box: { x: a.x, y: a.y, w: a.w, h: a.h },
    })
  }

  const onHandleDown = (e: ReactPointerEvent, a: Annotation, handle: Handle) => {
    if (e.button !== 0) return
    begin(e, {
      kind: 'resize',
      id: a.id,
      handle,
      start: toNormalized(e),
      box: { x: a.x, y: a.y, w: a.w, h: a.h },
      square: a.type === 'marker' ? width / height : undefined,
    })
  }

  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = toNormalized(e)
    if (d.kind === 'draw') {
      setDraft({ id: null, box: boxFromPoints(d.start, p) })
    } else if (d.kind === 'move') {
      setDraft({ id: d.id, box: moveBox(d.box, p.x - d.start.x, p.y - d.start.y) })
    } else {
      const box = resizeBox(d.box, d.handle, p.x - d.start.x, p.y - d.start.y, {
        minW: 8 / width,
        minH: 8 / height,
        squareAspect: d.square,
      })
      setDraft({ id: d.id, box })
    }
  }

  const finish = (commit: boolean) => {
    const d = drag.current
    const current = draftRef.current
    drag.current = null
    setDraft(null)
    if (!d || !commit) return
    if (d.kind === 'draw') {
      const tiny =
        !current ||
        (current.box.w * width * zoom < CLICK_SLOP && current.box.h * height * zoom < CLICK_SLOP)
      // A click (rather than a drag) drops a default-sized 2:1 ellipse.
      const box = tiny
        ? centeredBox(d.start, width * 0.16, width * 0.08, width, height)
        : current.box
      onCreate({
        id: newId(),
        type: 'ellipse',
        ...box,
        color: tools.color,
        ...(tools.numbered ? { number: nextNumber(step.annotations) } : {}),
      })
    } else if (current && current.id === d.id && !sameBox(current.box, d.box)) {
      onChange(d.id, current.box)
    }
  }

  const hit = 14 / zoom
  const annotations = step.annotations.map((a) =>
    draft && draft.id === a.id ? { ...a, ...draft.box } : a,
  )
  const selected = annotations.find((a) => a.id === selectedId)

  return (
    <svg
      ref={svg}
      className="annotations"
      data-tool={tools.tool}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      onPointerDown={onBackgroundDown}
      onPointerMove={onMove}
      onPointerUp={() => finish(true)}
      onPointerCancel={() => finish(false)}
    >
      {annotations.map((a) => (
        <AnnotationShape
          key={a.id}
          annotation={a}
          width={width}
          height={height}
          hitWidth={hit}
          onPointerDown={(e) => onShapeDown(e, a)}
        />
      ))}

      {draft?.id === null && draft.box.w > 0 && (
        <ellipse
          className="draft"
          cx={(draft.box.x + draft.box.w / 2) * width}
          cy={(draft.box.y + draft.box.h / 2) * height}
          rx={(draft.box.w / 2) * width}
          ry={(draft.box.h / 2) * height}
          fill="none"
          stroke={COLOR_HEX[tools.color]}
          strokeWidth={STYLE.annotationStroke}
          strokeDasharray={`${8 / zoom} ${6 / zoom}`}
        />
      )}

      {selected && (
        <SelectionHandles
          annotation={selected}
          width={width}
          height={height}
          zoom={zoom}
          onHandleDown={(e, h) => onHandleDown(e, selected, h)}
        />
      )}
    </svg>
  )
}

function AnnotationShape({
  annotation: a,
  width,
  height,
  hitWidth,
  onPointerDown,
}: {
  annotation: Annotation
  width: number
  height: number
  hitWidth: number
  onPointerDown: (e: ReactPointerEvent) => void
}) {
  const px = toPixels(a, width, height)
  const color = COLOR_HEX[a.color]
  const cx = px.x + px.w / 2
  const cy = px.y + px.h / 2

  if (a.type === 'marker') {
    const r = Math.min(px.w, px.h) / 2
    return (
      <g className="annotation" onPointerDown={onPointerDown}>
        <Badge x={cx} y={cy} r={r} color={color} number={a.number ?? 1} ring={STYLE.markerRing} />
      </g>
    )
  }

  const badge = a.number !== undefined ? badgeAnchor(px) : null
  return (
    <g className="annotation">
      <ellipse
        cx={cx}
        cy={cy}
        rx={px.w / 2}
        ry={px.h / 2}
        fill="none"
        stroke="rgba(255,255,255,0.85)"
        strokeWidth={STYLE.annotationStroke + STYLE.annotationHalo * 2}
        pointerEvents="none"
      />
      <ellipse
        cx={cx}
        cy={cy}
        rx={px.w / 2}
        ry={px.h / 2}
        fill="none"
        stroke={color}
        strokeWidth={STYLE.annotationStroke}
        pointerEvents="none"
      />
      {/* Wide invisible stroke: easy to grab, while the interior stays free for
          drawing or placing a marker inside the ellipse. */}
      <ellipse
        className="annotation-hit"
        cx={cx}
        cy={cy}
        rx={px.w / 2}
        ry={px.h / 2}
        fill="none"
        stroke="transparent"
        strokeWidth={hitWidth}
        pointerEvents="stroke"
        onPointerDown={onPointerDown}
      />
      {badge && (
        <g onPointerDown={onPointerDown} className="annotation-badge">
          <Badge
            x={badge.x}
            y={badge.y}
            r={STYLE.badgeRadius}
            color={color}
            number={a.number!}
            ring={2}
          />
        </g>
      )}
    </g>
  )
}

function Badge({
  x,
  y,
  r,
  color,
  number,
  ring,
}: {
  x: number
  y: number
  r: number
  color: string
  number: number
  ring: number
}) {
  return (
    <>
      <circle cx={x} cy={y} r={r} fill={color} stroke="#fff" strokeWidth={ring} />
      <text
        x={x}
        y={y + r * 0.04}
        textAnchor="middle"
        dominantBaseline="central"
        fill="#fff"
        fontWeight={700}
        fontSize={Math.max(9, Math.round(r * 1.05))}
        pointerEvents="none"
      >
        {number}
      </text>
    </>
  )
}

function SelectionHandles({
  annotation,
  width,
  height,
  zoom,
  onHandleDown,
}: {
  annotation: Annotation
  width: number
  height: number
  zoom: number
  onHandleDown: (e: ReactPointerEvent, handle: Handle) => void
}) {
  const px = toPixels(annotation, width, height)
  const size = 10 / zoom
  const handles = annotation.type === 'marker' ? CORNER_HANDLES : ALL_HANDLES
  return (
    <g className="selection">
      <rect
        x={px.x}
        y={px.y}
        width={px.w}
        height={px.h}
        fill="none"
        stroke={STYLE.accent}
        strokeWidth={1.5 / zoom}
        strokeDasharray={`${4 / zoom} ${3 / zoom}`}
        pointerEvents="none"
      />
      {handles.map((h) => {
        const p = handlePoint(px, h)
        return (
          <rect
            key={h}
            className="handle"
            x={p.x - size / 2}
            y={p.y - size / 2}
            width={size}
            height={size}
            rx={2 / zoom}
            fill="#fff"
            stroke={STYLE.accent}
            strokeWidth={1.5 / zoom}
            style={{ cursor: HANDLE_CURSOR[h] }}
            onPointerDown={(e) => onHandleDown(e, h)}
          />
        )
      })}
    </g>
  )
}
