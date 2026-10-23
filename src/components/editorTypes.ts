import type { AnnotationColor } from '../types'

export type Tool = 'select' | 'ellipse' | 'marker'

export interface Selection {
  stepId: string | null
  annotationId: string | null
}

export interface ToolState {
  tool: Tool
  color: AnnotationColor
  /** New ellipses get a number badge. */
  numbered: boolean
}
