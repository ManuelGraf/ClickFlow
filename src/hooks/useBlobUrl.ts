import { useEffect, useState } from 'react'
import { BlobUrlCache } from '../lib/blobUrls'
import { getBlob } from '../db/db'

/** The app's single object-URL cache for stored screenshots and thumbnails. */
export const blobUrls = new BlobUrlCache((id) => getBlob(id))

export type BlobUrlState =
  | { status: 'loading'; url: null }
  | { status: 'ready'; url: string }
  | { status: 'missing'; url: null }

/** Object URL for a stored blob, released automatically on unmount or id change. */
export function useBlobUrl(id: string | undefined): BlobUrlState {
  const [state, setState] = useState<{ id?: string; url: string | null; done: boolean }>(() => ({
    id,
    url: id ? blobUrls.peek(id) : null,
    done: false,
  }))

  useEffect(() => {
    if (!id) return
    let active = true
    void blobUrls.acquire(id).then((url) => {
      if (active) setState({ id, url, done: true })
    })
    return () => {
      active = false
      blobUrls.release(id)
    }
  }, [id])

  if (!id) return { status: 'missing', url: null }
  const url = state.id === id ? state.url : blobUrls.peek(id)
  if (url) return { status: 'ready', url }
  if (state.id === id && state.done) return { status: 'missing', url: null }
  return { status: 'loading', url: null }
}
