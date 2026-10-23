// Browsers cap canvas size (Chrome/Firefox ~32767px per side, area limits
// around 268M px, and far less memory in practice). Very long flows at 2× can
// exceed that, so the export ratio is reduced to fit and the UI says so.

export const MAX_CANVAS_SIDE = 32_000
export const MAX_CANVAS_PIXELS = 120_000_000

export interface ExportSize {
  width: number
  height: number
  /** Canvas pixels per canvas unit actually used. */
  ratio: number
  /** True when the requested scale had to be reduced. */
  reduced: boolean
}

export function computeExportSize(
  contentWidth: number,
  contentHeight: number,
  scale: number,
): ExportSize {
  const ratio = Math.min(
    scale,
    MAX_CANVAS_SIDE / contentWidth,
    MAX_CANVAS_SIDE / contentHeight,
    Math.sqrt(MAX_CANVAS_PIXELS / (contentWidth * contentHeight)),
  )
  return {
    width: Math.max(1, Math.floor(contentWidth * ratio)),
    height: Math.max(1, Math.floor(contentHeight * ratio)),
    ratio,
    reduced: ratio < scale - 1e-9,
  }
}
