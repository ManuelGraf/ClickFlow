import { memo, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { GripHorizontal, ImageOff } from 'lucide-react'
import type { Annotation, Step } from '../types'
import type { Box } from '../lib/geometry'
import { LAYOUT, type CardBox } from '../lib/layout'
import { useBlobUrl } from '../hooks/useBlobUrl'
import { AnnotationLayer } from './AnnotationLayer'
import type { ToolState } from './editorTypes'

export type ReorderPhase = 'move' | 'end' | 'cancel'

export interface StepCallbacks {
  onSelectStep: (stepId: string) => void
  onSelectAnnotation: (stepId: string, annotationId: string | null) => void
  onCreateAnnotation: (stepId: string, annotation: Annotation) => void
  onChangeAnnotation: (stepId: string, annotationId: string, box: Box) => void
  onTitle: (stepId: string, title: string) => void
  onDescription: (stepId: string, description: string) => void
  /** Drag-to-reorder by the window chrome; deltas in screen px. */
  onReorder: (index: number, phase: ReorderPhase, dx: number, dy: number) => void
}

interface StepCardProps extends StepCallbacks {
  step: Step
  index: number
  card: CardBox
  zoom: number
  tools: ToolState
  selected: boolean
  selectedAnnotationId: string | null
  /** Offset while being dragged, in canvas units. */
  dragOffset: { dx: number; dy: number } | null
}

export const StepCard = memo(function StepCard({
  step,
  index,
  card,
  zoom,
  tools,
  selected,
  selectedAnnotationId,
  dragOffset,
  onSelectStep,
  onSelectAnnotation,
  onCreateAnnotation,
  onChangeAnnotation,
  onTitle,
  onDescription,
  onReorder,
}: StepCardProps) {
  const image = useBlobUrl(step.screenshotBlobId)
  const description = useRef<HTMLTextAreaElement>(null)
  const reorder = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const number = index + 1

  // Grow the description field with its content.
  useLayoutEffect(() => {
    const el = description.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [step.description, card.width])

  const onChromeDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    reorder.current = { x: e.clientX, y: e.clientY, moved: false }
    onSelectStep(step.id)
  }
  const onChromeMove = (e: ReactPointerEvent) => {
    const r = reorder.current
    if (!r) return
    const dx = e.clientX - r.x
    const dy = e.clientY - r.y
    if (!r.moved && Math.hypot(dx, dy) < 4) return
    r.moved = true
    onReorder(index, 'move', dx, dy)
  }
  const onChromeUp = (e: ReactPointerEvent, cancel: boolean) => {
    const r = reorder.current
    reorder.current = null
    if (r?.moved) onReorder(index, cancel ? 'cancel' : 'end', e.clientX - r.x, e.clientY - r.y)
  }

  return (
    <div
      className="step"
      data-selected={selected || undefined}
      data-dragging={dragOffset ? true : undefined}
      style={{
        left: card.x,
        top: card.labelY,
        width: card.width,
        transform: dragOffset ? `translate(${dragOffset.dx}px, ${dragOffset.dy}px)` : undefined,
      }}
      onPointerDown={() => onSelectStep(step.id)}
    >
      <div className="step-label" style={{ height: LAYOUT.labelHeight }}>
        <span className="step-badge" aria-hidden>
          {number}
        </span>
        <input
          className="step-title"
          value={step.title}
          placeholder="Add a title"
          aria-label={`Step ${number} title`}
          maxLength={200}
          onChange={(e) => onTitle(step.id, e.target.value)}
          onFocus={() => onSelectStep(step.id)}
        />
      </div>

      <div
        className="card"
        style={{ height: card.height }}
        tabIndex={0}
        role="group"
        aria-roledescription="step"
        aria-label={`Step ${number}${step.title ? `: ${step.title}` : ''}, ${step.annotations.length} highlight${step.annotations.length === 1 ? '' : 's'}`}
        onFocus={(e) => {
          if (e.target === e.currentTarget) onSelectStep(step.id)
        }}
      >
        <div
          className="card-chrome"
          style={{ height: LAYOUT.chromeHeight }}
          title="Drag to reorder"
          onPointerDown={onChromeDown}
          onPointerMove={onChromeMove}
          onPointerUp={(e) => onChromeUp(e, false)}
          onPointerCancel={(e) => onChromeUp(e, true)}
        >
          <span className="chrome-dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <GripHorizontal size={16} aria-hidden className="chrome-grip" />
        </div>
        <div className="card-image" style={{ height: card.imageHeight }}>
          {image.status === 'ready' && (
            <img
              src={image.url}
              alt={`Screenshot for step ${number}`}
              draggable={false}
              decoding="async"
            />
          )}
          {image.status === 'missing' && (
            <div className="image-missing">
              <ImageOff size={24} aria-hidden />
              <span>Screenshot missing</span>
            </div>
          )}
          <AnnotationLayer
            step={step}
            width={card.width}
            height={card.imageHeight}
            zoom={zoom}
            tools={tools}
            selectedId={selected ? selectedAnnotationId : null}
            onSelect={(id) => onSelectAnnotation(step.id, id)}
            onCreate={(a) => onCreateAnnotation(step.id, a)}
            onChange={(id, box) => onChangeAnnotation(step.id, id, box)}
          />
        </div>
      </div>

      <textarea
        ref={description}
        className="step-desc"
        value={step.description}
        placeholder="Add a description"
        aria-label={`Step ${number} description`}
        rows={1}
        maxLength={2000}
        style={{ marginTop: LAYOUT.descriptionGap }}
        onChange={(e) => onDescription(step.id, e.target.value)}
        onFocus={() => onSelectStep(step.id)}
      />
    </div>
  )
})
