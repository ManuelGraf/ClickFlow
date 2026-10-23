/**
 * Greedy word wrap for canvas text. Honors explicit line breaks, breaks words
 * that are wider than a whole line, and ends with an ellipsis when `maxLines`
 * cuts the text short.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
  maxLines = Infinity,
): string[] {
  const lines: string[] = []
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word
      if (measure(candidate) <= maxWidth) {
        line = candidate
        continue
      }
      if (line) lines.push(line)
      line = ''
      // Hard-break a word that does not fit on a line of its own.
      let rest = word
      while (measure(rest) > maxWidth && rest.length > 1) {
        let cut = rest.length - 1
        while (cut > 1 && measure(rest.slice(0, cut)) > maxWidth) cut--
        lines.push(rest.slice(0, cut))
        rest = rest.slice(cut)
      }
      line = rest
    }
    lines.push(line)
  }
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()

  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  kept[maxLines - 1] = truncate(kept[maxLines - 1]!, maxWidth, measure, true)
  return kept
}

/** Shorten a single line to fit, appending an ellipsis if anything was cut. */
export function truncate(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
  force = false,
): string {
  if (!force && measure(text) <= maxWidth) return text
  let s = text
  while (s.length > 0 && measure(`${s}…`) > maxWidth) s = s.slice(0, -1)
  return `${s.trimEnd()}…`
}
