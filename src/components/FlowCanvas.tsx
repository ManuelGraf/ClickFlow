import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { ImagePlus } from 'lucide-react'
import type { FlowDoc } from '../types'
import { LAYOUT, STYLE, slotAt, slotX, type FlowLayout } from '../lib/layout'
import { hasFiles, imageFilesFrom } from '../lib/images'
import type { View } from '../hooks/usePanZoom'
import { StepCard, type StepCallbacks } from './StepCard'
import type { Selection, ToolState } from './editorTypes'

interface FlowCanvasProps extends StepCallbacks {
  doc: FlowDoc
  layout: FlowLayout
  view: View
  viewportRef: RefObject<HTMLDivElement | null>
  selection: Selection
  tools: ToolState
  /** Space is held: any drag pans. */
  spacePan: boolean
  reorder: { index: number; dx: number; dy: number } | null
  onPan: (dx: number, dy: number) => void
  onBackgroundClick: () => void
  onDropFiles: (files: File[], slot: number) => void
  onPickFiles: () => void
}

export function FlowCanvas(props: FlowCanvasProps) {
  const { doc, layout, view, viewportRef, selection, tools, spacePan, reorder } = props
  const pan = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const [panning, setPanning] = useState(false)
  const [fileSlot, setFileSlot] = useState<number | null>(null)

  const toCanvasX = (clientX: number) => {
    const r = viewportRef.current!.getBoundingClientRect()
    return (clientX - r.left - view.x) / view.zoom
  }

  const startPan = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Only the bare background pans; cards, inputs and annotations handle their own drags.
    const background = (e.target as Element).hasAttribute('data-pan')
    const middle = e.button === 1
    if (!(middle || (e.button === 0 && (spacePan || background)))) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    pan.current = { x: e.clientX, y: e.clientY, moved: false }
  }
  const movePan = (e: ReactPointerEvent) => {
    const p = pan.current
    if (!p) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    if (!p.moved && Math.hypot(dx, dy) < 3) return
    p.moved = true
    setPanning(true)
    p.x = e.clientX
    p.y = e.clientY
    props.onPan(dx, dy)
  }
  const endPan = () => {
    const p = pan.current
    pan.current = null
    setPanning(false)
    if (p && !p.moved) props.onBackgroundClick()
  }

  // Reorder preview: the dragged card follows the pointer; a bar marks the slot.
  let reorderSlot: number | null = null
  if (reorder) {
    const card = layout.cards[reorder.index]
    if (card) {
      const slot = slotAt(layout.cards, card.x + card.width / 2 + reorder.dx / view.zoom)
      if (slot !== reorder.index && slot !== reorder.index + 1) reorderSlot = slot
    }
  }
  const indicatorSlot = fileSlot ?? reorderSlot
  const cardsTop = layout.cards[0]?.labelY ?? LAYOUT.pad + LAYOUT.titleBlock
  const empty = doc.steps.length === 0

  return (
    <div
      ref={viewportRef}
      className="viewport"
      data-pan
      data-panning={panning || undefined}
      data-space={spacePan || undefined}
      role="region"
      aria-label="Flow canvas"
      onPointerDownCapture={(e) => {
        if (spacePan || e.button === 1) startPan(e)
      }}
      onPointerDown={startPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onDragOver={(e) => {
        if (!hasFiles(e.dataTransfer)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setFileSlot(empty ? 0 : slotAt(layout.cards, toCanvasX(e.clientX)))
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setFileSlot(null)
      }}
      onDrop={(e) => {
        e.preventDefault()
        const slot = empty ? 0 : slotAt(layout.cards, toCanvasX(e.clientX))
        setFileSlot(null)
        const files = imageFilesFrom(e.dataTransfer)
        if (files.length > 0) props.onDropFiles(files, slot)
      }}
    >
      <div
        className="world"
        data-pan
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
      >
        <div
          className="canvas-title"
          data-pan
          style={{ left: LAYOUT.pad, top: LAYOUT.pad, maxWidth: layout.width - LAYOUT.pad * 2 }}
        >
          {doc.flow.title || 'Untitled flow'}
        </div>

        <svg
          className="arrows"
          data-pan
          width={layout.width}
          height={layout.cardsBottom}
          aria-hidden
        >
          {layout.arrows.map((a, i) => (
            <g key={i}>
              <line
                x1={a.x1}
                y1={a.y}
                x2={a.x2 - LAYOUT.arrowHead + 2}
                y2={a.y}
                stroke={STYLE.arrow}
                strokeWidth={STYLE.arrowWidth}
                strokeLinecap="round"
              />
              <polygon
                points={`${a.x2},${a.y} ${a.x2 - LAYOUT.arrowHead},${a.y - LAYOUT.arrowHead * 0.6} ${a.x2 - LAYOUT.arrowHead},${a.y + LAYOUT.arrowHead * 0.6}`}
                fill={STYLE.arrow}
              />
            </g>
          ))}
        </svg>

        {doc.steps.map((step, i) => (
          <StepCard
            key={step.id}
            step={step}
            index={i}
            card={layout.cards[i]!}
            zoom={view.zoom}
            tools={tools}
            selected={selection.stepId === step.id}
            selectedAnnotationId={selection.stepId === step.id ? selection.annotationId : null}
            dragOffset={
              reorder?.index === i
                ? { dx: reorder.dx / view.zoom, dy: reorder.dy / view.zoom }
                : null
            }
            onSelectStep={props.onSelectStep}
            onSelectAnnotation={props.onSelectAnnotation}
            onCreateAnnotation={props.onCreateAnnotation}
            onChangeAnnotation={props.onChangeAnnotation}
            onTitle={props.onTitle}
            onDescription={props.onDescription}
            onReorder={props.onReorder}
          />
        ))}

        {indicatorSlot !== null && !empty && (
          <div
            className="slot-indicator"
            style={{
              left: slotX(layout.cards, indicatorSlot) - 2,
              top: cardsTop,
              height: layout.cardsBottom - cardsTop,
            }}
          />
        )}
      </div>

      {empty && (
        <div className="canvas-empty" data-active={fileSlot !== null || undefined}>
          <ImagePlus size={36} aria-hidden />
          <h2>Add your screenshots</h2>
          <p>
            Drop images here, paste with <kbd>Ctrl</kbd>+<kbd>V</kbd>, or choose files. PNG, JPEG
            and WebP work; several at once are fine.
          </p>
          <button type="button" className="btn btn-primary" onClick={props.onPickFiles}>
            Choose screenshots
          </button>
          <p className="muted small">
            Then press <kbd>E</kbd> and drag on a screenshot to circle what to click.
          </p>
        </div>
      )}
    </div>
  )
}
