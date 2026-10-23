import type { DBSchema, IDBPDatabase, IDBPTransaction, StoreNames } from 'idb'
import type { BlobRecord, Flow, Step } from '../types'

export const DB_NAME = 'clickflow'

/**
 * Bump this and add an entry to MIGRATIONS whenever the stores, indexes or
 * record shapes change. Migrations run in order from the stored version, inside
 * the single versionchange transaction, so a failed upgrade leaves the old
 * database untouched.
 */
export const DB_VERSION = 1

/**
 * Three stores keep small metadata away from large binaries:
 * - `flows`  flow metadata, including the ordered step ids
 * - `steps`  one record per step (title, description, annotations)
 * - `blobs`  screenshot and thumbnail binaries, referenced by id
 * Listing the library therefore never reads image data.
 */
export interface ClickFlowDB extends DBSchema {
  flows: { key: string; value: Flow; indexes: { updatedAt: number } }
  steps: { key: string; value: Step; indexes: { flowId: string } }
  blobs: { key: string; value: BlobRecord }
}

export type UpgradeTx = IDBPTransaction<ClickFlowDB, StoreNames<ClickFlowDB>[], 'versionchange'>
type Migration = (db: IDBPDatabase<ClickFlowDB>, tx: UpgradeTx) => void

export const MIGRATIONS: Record<number, Migration> = {
  1: (db) => {
    const flows = db.createObjectStore('flows', { keyPath: 'id' })
    flows.createIndex('updatedAt', 'updatedAt')
    const steps = db.createObjectStore('steps', { keyPath: 'id' })
    steps.createIndex('flowId', 'flowId')
    db.createObjectStore('blobs', { keyPath: 'id' })
  },
  // 2: (db, tx) => { ...e.g. tx.objectStore('steps').createIndex(...) }
}

export function runMigrations(
  db: IDBPDatabase<ClickFlowDB>,
  oldVersion: number,
  newVersion: number,
  tx: UpgradeTx,
): void {
  for (let v = oldVersion + 1; v <= newVersion; v++) {
    const migrate = MIGRATIONS[v]
    if (!migrate) throw new Error(`Missing IndexedDB migration to version ${v}`)
    migrate(db, tx)
  }
}
