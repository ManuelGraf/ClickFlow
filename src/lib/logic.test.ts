import { describe, expect, it, vi } from 'vitest'
import type { FlowDoc, Step } from '../types'
import { DEFAULT_CANVAS, DEFAULT_EXPORT } from '../types'
import { computeLayout, LAYOUT, slotAt, slotX } from './layout'
import {
  addAnnotation,
  addSteps,
  duplicateStep,
  moveStep,
  removeAnnotation,
  removeStep,
  updateAnnotation,
  updateStep,
} from './flowOps'
import { commit, COALESCE_MS, createHistory, HISTORY_LIMIT, redo, undo } from './history'
import { truncate, wrapText } from './text'
import { planImport, sniffImageType, MAX_IMAGE_WIDTH } from './images'
import { computeExportSize, MAX_CANVAS_SIDE } from './exportSize'
import { fileNameFor, formatBytes, formatRelative, matchesSearch } from './format'
import { BlobUrlCache } from './blobUrls'

function makeStep(id: string, w = 1440, h = 900): Step {
  return {
    id,
    flowId: 'f',
    screenshotBlobId: `blob-${id}`,
    order: 0,
    title: id,
    description: '',
    imageWidth: w,
    imageHeight: h,
    annotations: [],
  }
}

function makeDoc(ids: string[]): FlowDoc {
  const doc: FlowDoc = {
    flow: {
      id: 'f',
      title: 'T',
      createdAt: 0,
      updatedAt: 0,
      stepIds: [],
      canvas: DEFAULT_CANVAS,
      export: DEFAULT_EXPORT,
    },
    steps: [],
  }
  return addSteps(
    doc,
    ids.map((id) => makeStep(id)),
  )
}

const ids = (doc: FlowDoc) => doc.steps.map((s) => s.id)

describe('layout', () => {
  it('places cards left to right and connects neighbours', () => {
    const layout = computeLayout([makeStep('a'), makeStep('b', 1000, 2000), makeStep('c')], 640)
    expect(layout.cards.map((c) => c.x)).toEqual([64, 64 + 640 + 112, 64 + 2 * (640 + 112)])
    expect(layout.cards[0]!.imageHeight).toBe(400)
    expect(layout.cards[1]!.imageHeight).toBe(1280)
    expect(layout.arrows).toHaveLength(2)
    const [first] = layout.arrows
    expect(first!.x1).toBe(64 + 640 + LAYOUT.arrowInset)
    expect(first!.x2).toBe(64 + 640 + 112 - LAYOUT.arrowInset)
    // Middle of the shorter screenshot.
    expect(first!.y).toBe(layout.cards[0]!.imageY + 200)
    expect(layout.width).toBe(64 * 2 + 3 * 640 + 2 * 112)
    expect(layout.cardsBottom).toBe(layout.cards[1]!.y + layout.cards[1]!.height)
  })

  it('handles an empty flow and degenerate images', () => {
    const empty = computeLayout([], 640)
    expect(empty.cards).toEqual([])
    expect(empty.width).toBe(64 * 2 + 640)
    expect(computeLayout([makeStep('x', 0, 0)], 640).cards[0]!.imageHeight).toBe(400)
  })

  it('maps pointer x to insertion slots', () => {
    const { cards } = computeLayout([makeStep('a'), makeStep('b')], 640)
    expect(slotAt(cards, 0)).toBe(0)
    expect(slotAt(cards, cards[0]!.x + 400)).toBe(1)
    expect(slotAt(cards, 99_999)).toBe(2)
    expect(slotX(cards, 1)).toBe(cards[1]!.x - 56)
  })
})

describe('flow operations', () => {
  it('adds steps at a position and keeps order fields in sync', () => {
    const doc = addSteps(makeDoc(['a', 'c']), [makeStep('b')], 1)
    expect(ids(doc)).toEqual(['a', 'b', 'c'])
    expect(doc.flow.stepIds).toEqual(['a', 'b', 'c'])
    expect(doc.steps.map((s) => s.order)).toEqual([0, 1, 2])
  })

  it('moves steps using insertion slots', () => {
    const doc = makeDoc(['a', 'b', 'c', 'd'])
    expect(ids(moveStep(doc, 0, 4))).toEqual(['b', 'c', 'd', 'a'])
    expect(ids(moveStep(doc, 3, 0))).toEqual(['d', 'a', 'b', 'c'])
    expect(ids(moveStep(doc, 1, 3))).toEqual(['a', 'c', 'b', 'd'])
    expect(moveStep(doc, 1, 1)).toBe(doc)
    expect(moveStep(doc, 1, 2)).toBe(doc)
  })

  it('duplicates a step after itself with new ids but the same screenshot', () => {
    let doc = makeDoc(['a', 'b'])
    doc = addAnnotation(doc, 'a', {
      id: 'n1',
      type: 'ellipse',
      x: 0,
      y: 0,
      w: 0.1,
      h: 0.1,
      color: 'red',
    })
    let n = 0
    const result = duplicateStep(doc, 'a', () => `new${++n}`)!
    expect(ids(result.doc)).toEqual(['a', 'new1', 'b'])
    expect(result.doc.steps[1]!.screenshotBlobId).toBe('blob-a')
    expect(result.doc.steps[1]!.annotations[0]!.id).toBe('new2')
  })

  it('removes steps and annotations, and leaves unrelated steps untouched', () => {
    let doc = makeDoc(['a', 'b'])
    const b = doc.steps[1]
    doc = updateStep(doc, 'a', { title: 'Login' })
    expect(doc.steps[1]).toBe(b)
    doc = addAnnotation(doc, 'a', {
      id: 'x',
      type: 'marker',
      x: 0,
      y: 0,
      w: 0.1,
      h: 0.1,
      color: 'blue',
      number: 1,
    })
    doc = updateAnnotation(doc, 'a', 'x', { number: undefined, color: 'green' })
    expect(doc.steps[0]!.annotations[0]).not.toHaveProperty('number')
    expect(doc.steps[0]!.annotations[0]!.color).toBe('green')
    doc = removeAnnotation(doc, 'a', 'x')
    expect(doc.steps[0]!.annotations).toEqual([])
    doc = removeStep(doc, 'a')
    expect(ids(doc)).toEqual(['b'])
    expect(doc.steps[0]!.order).toBe(0)
  })

  it('returns the same document for no-op edits', () => {
    const doc = makeDoc(['a'])
    expect(removeStep(doc, 'zzz')).toBe(doc)
    expect(removeAnnotation(doc, 'a', 'zzz')).toBe(doc)
    expect(updateAnnotation(doc, 'a', 'zzz', { color: 'red' })).toBe(doc)
  })
})

describe('history', () => {
  it('undoes and redoes', () => {
    let h = createHistory(1)
    h = commit(h, 2, { now: 0 })
    h = commit(h, 3, { now: 5000 })
    h = undo(h)
    expect(h.present).toBe(2)
    h = undo(h)
    expect(h.present).toBe(1)
    expect(undo(h)).toBe(h)
    h = redo(h)
    expect(h.present).toBe(2)
    h = commit(h, 9, { now: 9000 })
    expect(h.future).toEqual([])
  })

  it('coalesces bursts with the same key', () => {
    let h = createHistory('')
    h = commit(h, 'a', { coalesceKey: 'title', now: 0 })
    h = commit(h, 'ab', { coalesceKey: 'title', now: 200 })
    h = commit(h, 'abc', { coalesceKey: 'title', now: 400 })
    expect(h.past).toEqual([''])
    h = commit(h, 'abcd', { coalesceKey: 'title', now: 400 + COALESCE_MS + 1 })
    expect(h.past).toEqual(['', 'abc'])
    h = commit(h, 'x', { coalesceKey: 'other', now: 400 + COALESCE_MS + 2 })
    expect(h.past).toHaveLength(3)
  })

  it('caps its length', () => {
    let h = createHistory(0)
    for (let i = 1; i <= HISTORY_LIMIT + 50; i++) h = commit(h, i, { now: i * 10_000 })
    expect(h.past).toHaveLength(HISTORY_LIMIT)
  })
})

describe('text wrapping', () => {
  const measure = (s: string) => s.length * 10

  it('wraps words and keeps explicit line breaks', () => {
    expect(wrapText('one two three four', 100, measure)).toEqual(['one two', 'three four'])
    expect(wrapText('a\nb', 100, measure)).toEqual(['a', 'b'])
  })

  it('breaks overlong words', () => {
    expect(wrapText('abcdefghijkl', 50, measure)).toEqual(['abcde', 'fghij', 'kl'])
  })

  it('ellipsizes when lines run out', () => {
    const lines = wrapText('one two three four five six', 100, measure, 2)
    expect(lines).toHaveLength(2)
    expect(lines[1]!.endsWith('…')).toBe(true)
    expect(measure(lines[1]!)).toBeLessThanOrEqual(100)
    expect(truncate('short', 100, measure)).toBe('short')
  })
})

describe('image import', () => {
  it('sniffs supported formats by content', () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toBe('image/png')
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xdb]))).toBe('image/jpeg')
    const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')
    expect(sniffImageType(webp)).toBe('image/webp')
    expect(sniffImageType(new TextEncoder().encode('GIF89a......'))).toBeNull()
    expect(sniffImageType(new Uint8Array([]))).toBeNull()
  })

  it('keeps ordinary screenshots untouched', () => {
    expect(planImport(1440, 900, 400_000)).toEqual({ width: 1440, height: 900, reencode: false })
  })

  it('downscales very wide or very large images', () => {
    const wide = planImport(5760, 3600, 1_000_000)
    expect(wide).toEqual({ width: MAX_IMAGE_WIDTH, height: 1800, reencode: true })
    const tall = planImport(2000, 40_000, 1_000_000)
    expect(tall.reencode).toBe(true)
    expect(tall.width / tall.height).toBeCloseTo(2000 / 40_000, 2)
    expect(tall.width * tall.height).toBeLessThanOrEqual(2880 * 6000)
    expect(planImport(100, 1_000_000, 1000).height).toBeLessThanOrEqual(16_000)
  })

  it('re-encodes heavy files without resizing them', () => {
    expect(planImport(1440, 900, 8 * 1024 * 1024)).toEqual({
      width: 1440,
      height: 900,
      reencode: true,
    })
  })
})

describe('export size', () => {
  it('uses the requested scale when it fits', () => {
    expect(computeExportSize(2000, 1000, 2)).toEqual({
      width: 4000,
      height: 2000,
      ratio: 2,
      reduced: false,
    })
  })

  it('reduces the ratio for huge flows', () => {
    const size = computeExportSize(40_000, 1200, 2)
    expect(size.reduced).toBe(true)
    expect(size.width).toBeLessThanOrEqual(MAX_CANVAS_SIDE)
  })
})

describe('formatting', () => {
  it('formats bytes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(50 * 1024 * 1024)).toBe('50 MB')
  })

  it('formats relative times', () => {
    const now = 10_000_000_000
    expect(formatRelative(now - 10_000, now)).toBe('just now')
    expect(formatRelative(now - 5 * 60_000, now)).toBe('5 min ago')
    expect(formatRelative(now - 3 * 3_600_000, now)).toBe('3 h ago')
    expect(formatRelative(now - 26 * 3_600_000, now)).toBe('yesterday')
  })

  it('searches titles ignoring case and accents', () => {
    expect(matchesSearch('Café Checkout', 'cafe')).toBe(true)
    expect(matchesSearch('Café Checkout', 'check caf')).toBe(true)
    expect(matchesSearch('Café Checkout', 'login')).toBe(false)
    expect(matchesSearch('Anything', '  ')).toBe(true)
  })

  it('builds safe file names', () => {
    expect(fileNameFor('Sign-up: Step / 2 ✓', 'png')).toBe('sign-up-step-2.png')
    expect(fileNameFor('???', 'png')).toBe('clickflow.png')
  })
})

describe('BlobUrlCache', () => {
  function setup(delay = 0) {
    const created: string[] = []
    const revoked: string[] = []
    let n = 0
    const cache = new BlobUrlCache(
      async (id) => (id === 'missing' ? undefined : new Blob([id])),
      {
        create: () => {
          const url = `blob:${++n}`
          created.push(url)
          return url
        },
        revoke: (url) => revoked.push(url),
      },
      delay,
    )
    return { cache, created, revoked }
  }

  it('shares one URL per blob and revokes it after the last release', async () => {
    const { cache, created, revoked } = setup()
    const [a, b] = await Promise.all([cache.acquire('x'), cache.acquire('x')])
    expect(a).toBe(b)
    expect(created).toHaveLength(1)
    cache.release('x')
    expect(revoked).toEqual([])
    cache.release('x')
    expect(revoked).toEqual([a])
    expect(cache.size).toBe(0)
  })

  it('never creates a URL for a blob released while loading', async () => {
    const { cache, created } = setup()
    const pending = cache.acquire('x')
    cache.release('x')
    expect(await pending).toBeNull()
    expect(created).toEqual([])
  })

  it('reuses a URL re-acquired within the grace period', async () => {
    vi.useFakeTimers()
    try {
      const { cache, revoked } = setup(1000)
      const url = await cache.acquire('x')
      cache.release('x')
      expect(await cache.acquire('x')).toBe(url)
      vi.advanceTimersByTime(5000)
      expect(revoked).toEqual([])
      cache.release('x')
      vi.advanceTimersByTime(5000)
      expect(revoked).toEqual([url])
    } finally {
      vi.useRealTimers()
    }
  })

  it('resolves null for missing blobs and clears everything', async () => {
    const { cache, revoked } = setup()
    expect(await cache.acquire('missing')).toBeNull()
    const url = await cache.acquire('y')
    cache.clear()
    expect(revoked).toContain(url)
    expect(cache.size).toBe(0)
  })
})
