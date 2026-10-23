/** Save a Blob as a local file. The temporary object URL is always revoked. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.style.display = 'none'
  document.body.appendChild(a)
  try {
    a.click()
  } finally {
    a.remove()
    // The download starts asynchronously; revoking immediately can cancel it.
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
}
