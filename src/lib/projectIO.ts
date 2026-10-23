import type { Flow } from '../types'
import { collectProject, importProjectData } from '../db/db'
import { decodeProject, encodeProject, FILE_EXTENSION } from '../db/projectFile'
import { downloadBlob } from './download'
import { fileNameFor } from './format'
import { trackWrite, writesSettled } from './pending'

/** Download a backup of one flow (by title) or of every flow. */
export async function exportProjectFile(flow?: Pick<Flow, 'id' | 'title'>): Promise<number> {
  await writesSettled() // include edits whose autosave is still running
  const data = await collectProject(flow ? [flow.id] : undefined)
  const name = flow
    ? fileNameFor(flow.title, FILE_EXTENSION)
    : `clickflow-backup-${new Date().toISOString().slice(0, 10)}.${FILE_EXTENSION}`
  downloadBlob(encodeProject(data), name)
  return data.flows.length
}

/** Validate and add the flows from a backup file. Throws ProjectFileError / StorageError. */
export async function importProjectFile(file: Blob): Promise<Flow[]> {
  const data = await decodeProject(file)
  return trackWrite(importProjectData(data))
}

export const PROJECT_ACCEPT = `.${FILE_EXTENSION},application/octet-stream`
