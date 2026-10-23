// Pure edits on a FlowDoc. Each returns a new document (unchanged steps keep
// their identity) so the result can go straight into the undo history.

import type { Annotation, FlowDoc, Step } from '../types'
import { newId } from './ids'

/** Re-derive `order` and `flow.stepIds` from the steps array. */
function withSteps(doc: FlowDoc, steps: Step[]): FlowDoc {
  const ordered = steps.map((s, i) =>
    s.order === i && s.flowId === doc.flow.id ? s : { ...s, order: i, flowId: doc.flow.id },
  )
  return { flow: { ...doc.flow, stepIds: ordered.map((s) => s.id) }, steps: ordered }
}

export function addSteps(doc: FlowDoc, steps: Step[], at = doc.steps.length): FlowDoc {
  const index = Math.max(0, Math.min(at, doc.steps.length))
  return withSteps(doc, [...doc.steps.slice(0, index), ...steps, ...doc.steps.slice(index)])
}

export function removeStep(doc: FlowDoc, stepId: string): FlowDoc {
  if (!doc.steps.some((s) => s.id === stepId)) return doc
  return withSteps(
    doc,
    doc.steps.filter((s) => s.id !== stepId),
  )
}

/** Copy a step (same screenshot blob, fresh ids) directly after the original. */
export function duplicateStep(
  doc: FlowDoc,
  stepId: string,
  makeId: () => string = newId,
): { doc: FlowDoc; stepId: string } | null {
  const index = doc.steps.findIndex((s) => s.id === stepId)
  const source = doc.steps[index]
  if (!source) return null
  const copy: Step = {
    ...source,
    id: makeId(),
    annotations: source.annotations.map((a) => ({ ...a, id: makeId() })),
  }
  return { doc: addSteps(doc, [copy], index + 1), stepId: copy.id }
}

/**
 * Move a step to an insertion slot (0..steps.length) as produced by `slotAt`.
 * Slots are counted in the original order, so dropping a card right after
 * itself is a no-op.
 */
export function moveStep(doc: FlowDoc, from: number, slot: number): FlowDoc {
  const moving = doc.steps[from]
  if (!moving) return doc
  const to = slot > from ? slot - 1 : slot
  const clamped = Math.max(0, Math.min(to, doc.steps.length - 1))
  if (clamped === from) return doc
  const rest = doc.steps.filter((_, i) => i !== from)
  rest.splice(clamped, 0, moving)
  return withSteps(doc, rest)
}

function mapStep(doc: FlowDoc, stepId: string, fn: (step: Step) => Step): FlowDoc {
  let changed = false
  const steps = doc.steps.map((s) => {
    if (s.id !== stepId) return s
    const next = fn(s)
    if (next !== s) changed = true
    return next
  })
  return changed ? { ...doc, steps } : doc
}

export function updateStep(
  doc: FlowDoc,
  stepId: string,
  patch: Partial<Pick<Step, 'title' | 'description'>>,
): FlowDoc {
  return mapStep(doc, stepId, (s) => ({ ...s, ...patch }))
}

export function addAnnotation(doc: FlowDoc, stepId: string, annotation: Annotation): FlowDoc {
  return mapStep(doc, stepId, (s) => ({ ...s, annotations: [...s.annotations, annotation] }))
}

export function updateAnnotation(
  doc: FlowDoc,
  stepId: string,
  annotationId: string,
  patch: Partial<Omit<Annotation, 'id'>>,
): FlowDoc {
  return mapStep(doc, stepId, (s) => {
    if (!s.annotations.some((a) => a.id === annotationId)) return s
    return {
      ...s,
      annotations: s.annotations.map((a) => {
        if (a.id !== annotationId) return a
        const next = { ...a, ...patch }
        // `number: undefined` in a patch means "remove the badge".
        if ('number' in patch && patch.number === undefined) delete next.number
        return next
      }),
    }
  })
}

export function removeAnnotation(doc: FlowDoc, stepId: string, annotationId: string): FlowDoc {
  return mapStep(doc, stepId, (s) =>
    s.annotations.some((a) => a.id === annotationId)
      ? { ...s, annotations: s.annotations.filter((a) => a.id !== annotationId) }
      : s,
  )
}

export function setFlowTitle(doc: FlowDoc, title: string): FlowDoc {
  return title === doc.flow.title ? doc : { ...doc, flow: { ...doc.flow, title } }
}

export function setCardWidth(doc: FlowDoc, cardWidth: FlowDoc['flow']['canvas']['cardWidth']) {
  if (cardWidth === doc.flow.canvas.cardWidth) return doc
  return { ...doc, flow: { ...doc.flow, canvas: { ...doc.flow.canvas, cardWidth } } }
}
