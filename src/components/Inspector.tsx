import {
  ArrowLeft,
  ArrowRight,
  Circle,
  CircleDot,
  Copy,
  Hash,
  Keyboard,
  Trash2,
} from 'lucide-react'
import {
  ANNOTATION_COLORS,
  CARD_WIDTHS,
  COLOR_HEX,
  type Annotation,
  type AnnotationColor,
  type CardWidth,
  type FlowDoc,
  type Step,
} from '../types'

interface InspectorProps {
  doc: FlowDoc
  step: Step | null
  stepIndex: number
  annotation: Annotation | null
  onTitle: (value: string) => void
  onDescription: (value: string) => void
  onMoveStep: (delta: -1 | 1) => void
  onDuplicateStep: () => void
  onDeleteStep: () => void
  onSelectAnnotation: (id: string) => void
  onAnnotationColor: (color: AnnotationColor) => void
  onToggleNumber: () => void
  onDeleteAnnotation: (id: string) => void
  onCardWidth: (width: CardWidth) => void
  onShowShortcuts: () => void
}

const SIZE_LABELS: Record<CardWidth, string> = { 480: 'Small', 640: 'Medium', 800: 'Large' }
const COLOR_LABELS: Record<AnnotationColor, string> = {
  red: 'Red',
  orange: 'Orange',
  blue: 'Blue',
  green: 'Green',
}

export function ColorSwatches({
  value,
  onChange,
  label,
}: {
  value: AnnotationColor
  onChange: (c: AnnotationColor) => void
  label: string
}) {
  return (
    <div className="swatches" role="radiogroup" aria-label={label}>
      {ANNOTATION_COLORS.map((c, i) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={`${COLOR_LABELS[c]} (${i + 1})`}
          title={`${COLOR_LABELS[c]} (${i + 1})`}
          className="swatch"
          style={{ ['--swatch' as string]: COLOR_HEX[c] }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  )
}

export function Inspector(props: InspectorProps) {
  const { doc, step, stepIndex, annotation } = props

  if (!step) {
    return (
      <aside className="inspector" aria-label="Flow settings">
        <section className="panel">
          <h2 className="panel-title">Flow</h2>
          <p className="muted small">
            {doc.steps.length} step{doc.steps.length === 1 ? '' : 's'}. Select a screenshot to edit
            its title, description and highlights.
          </p>
          <fieldset className="field">
            <legend className="field-label">Screenshot size on canvas</legend>
            <div className="segmented" role="radiogroup" aria-label="Screenshot size on canvas">
              {CARD_WIDTHS.map((w) => (
                <button
                  key={w}
                  type="button"
                  role="radio"
                  aria-checked={doc.flow.canvas.cardWidth === w}
                  onClick={() => props.onCardWidth(w)}
                >
                  {SIZE_LABELS[w]}
                </button>
              ))}
            </div>
          </fieldset>
        </section>
        <section className="panel">
          <h2 className="panel-title">Quick guide</h2>
          <ol className="guide">
            <li>Drop, paste or choose screenshots. Drop between cards to insert there.</li>
            <li>Drag a card by its window bar to reorder.</li>
            <li>
              Press <kbd>E</kbd> and drag on a screenshot to circle a click target, or <kbd>M</kbd>{' '}
              and click to place a numbered marker.
            </li>
            <li>Type a title above each card and an optional note below it.</li>
            <li>
              Export with <kbd>Ctrl</kbd>+<kbd>E</kbd>.
            </li>
          </ol>
          <button type="button" className="btn btn-sm" onClick={props.onShowShortcuts}>
            <Keyboard size={16} aria-hidden /> Keyboard shortcuts
          </button>
        </section>
      </aside>
    )
  }

  return (
    <aside className="inspector" aria-label={`Step ${stepIndex + 1} settings`}>
      <section className="panel">
        <h2 className="panel-title">
          Step {stepIndex + 1} <span className="muted">of {doc.steps.length}</span>
        </h2>
        <label className="field">
          <span className="field-label">Title</span>
          <input
            className="input"
            value={step.title}
            maxLength={200}
            placeholder="e.g. Open settings"
            onChange={(e) => props.onTitle(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Description (optional)</span>
          <textarea
            className="input"
            rows={3}
            value={step.description}
            maxLength={2000}
            onChange={(e) => props.onDescription(e.target.value)}
          />
        </label>
        <div className="button-row">
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            aria-label="Move step left (Alt+Left)"
            title="Move left (Alt+←)"
            disabled={stepIndex === 0}
            onClick={() => props.onMoveStep(-1)}
          >
            <ArrowLeft size={16} aria-hidden />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            aria-label="Move step right (Alt+Right)"
            title="Move right (Alt+→)"
            disabled={stepIndex === doc.steps.length - 1}
            onClick={() => props.onMoveStep(1)}
          >
            <ArrowRight size={16} aria-hidden />
          </button>
          <span className="button-row-spacer" />
          <button
            type="button"
            className="btn btn-sm"
            onClick={props.onDuplicateStep}
            title="Duplicate (Ctrl+D)"
          >
            <Copy size={16} aria-hidden /> Duplicate
          </button>
          <button
            type="button"
            className="btn btn-sm btn-danger-outline"
            onClick={props.onDeleteStep}
            title="Delete (Del)"
          >
            <Trash2 size={16} aria-hidden /> Delete
          </button>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">Highlights</h2>
        {step.annotations.length === 0 ? (
          <p className="muted small">
            None yet. Press <kbd>E</kbd> and drag on the screenshot, or <kbd>M</kbd> and click.
          </p>
        ) : (
          <ul className="annotation-list">
            {step.annotations.map((a, i) => (
              <li key={a.id}>
                <button
                  type="button"
                  className="annotation-item"
                  aria-pressed={annotation?.id === a.id}
                  onClick={() => props.onSelectAnnotation(a.id)}
                >
                  {a.type === 'marker' ? (
                    <CircleDot size={16} color={COLOR_HEX[a.color]} aria-hidden />
                  ) : (
                    <Circle size={16} color={COLOR_HEX[a.color]} aria-hidden />
                  )}
                  <span>
                    {a.type === 'marker' ? 'Marker' : 'Highlight'}{' '}
                    {a.number !== undefined ? `#${a.number}` : i + 1}
                  </span>
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn-sm"
                  aria-label={`Delete ${a.type === 'marker' ? 'marker' : 'highlight'} ${i + 1}`}
                  onClick={() => props.onDeleteAnnotation(a.id)}
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        {annotation && (
          <div className="annotation-props">
            <span className="field-label">
              Selected {annotation.type === 'marker' ? 'marker' : 'highlight'}
            </span>
            <ColorSwatches
              value={annotation.color}
              onChange={props.onAnnotationColor}
              label="Highlight color"
            />
            {annotation.type === 'ellipse' && (
              <button
                type="button"
                className="btn btn-sm"
                aria-pressed={annotation.number !== undefined}
                onClick={props.onToggleNumber}
                title="Toggle number badge (N)"
              >
                <Hash size={16} aria-hidden />
                {annotation.number !== undefined
                  ? `Remove number ${annotation.number}`
                  : 'Add number'}
              </button>
            )}
            <p className="muted small">
              Drag to move, drag the handles to resize, arrow keys to nudge, <kbd>Del</kbd> to
              remove.
            </p>
          </div>
        )}
      </section>
    </aside>
  )
}
