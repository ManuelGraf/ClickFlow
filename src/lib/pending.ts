// Writes that were started on the way out of a screen (e.g. the editor's final
// autosave when the user hits Back). The library awaits them before listing so
// it never shows a stale timestamp or thumbnail.

const pending = new Set<Promise<unknown>>()

export function trackWrite<T>(promise: Promise<T>): Promise<T> {
  pending.add(promise)
  const done = () => pending.delete(promise)
  promise.then(done, done)
  return promise
}

export async function writesSettled(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending])
}
