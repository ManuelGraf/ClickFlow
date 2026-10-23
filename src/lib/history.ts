// Snapshot undo/redo. Documents are immutable and share structure between
// snapshots, so keeping a few hundred of them costs little; screenshot pixels
// live in IndexedDB and are referenced by id, never copied here.

export const HISTORY_LIMIT = 200
/** Edits with the same coalesce key this close together form one undo step. */
export const COALESCE_MS = 1000

export interface History<T> {
  past: T[]
  present: T
  future: T[]
  lastKey?: string
  lastAt?: number
}

export interface CommitOptions {
  /** e.g. `title:<stepId>` — merges a burst of keystrokes into one undo step. */
  coalesceKey?: string
  now?: number
}

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] }
}

export function commit<T>(history: History<T>, next: T, options: CommitOptions = {}): History<T> {
  if (next === history.present) return history
  const now = options.now ?? Date.now()
  const key = options.coalesceKey
  const merge =
    key !== undefined &&
    history.lastKey === key &&
    history.lastAt !== undefined &&
    now - history.lastAt < COALESCE_MS
  return {
    past: merge ? history.past : [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future: [],
    lastKey: key,
    lastAt: now,
  }
}

export function undo<T>(history: History<T>): History<T> {
  const previous = history.past[history.past.length - 1]
  if (previous === undefined) return history
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  }
}

export function redo<T>(history: History<T>): History<T> {
  const [next, ...rest] = history.future
  if (next === undefined) return history
  return { past: [...history.past, history.present], present: next, future: rest }
}
