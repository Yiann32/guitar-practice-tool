import Dexie, { type Table } from 'dexie'
import type { FretboardProgressRecord, SongRecord } from '../types'

interface SettingRecord {
  key: string
  value: unknown
}

class GuitarPracticeDb extends Dexie {
  songs!: Table<SongRecord, string>
  fretboard!: Table<FretboardProgressRecord, string>
  settings!: Table<SettingRecord, string>

  constructor() {
    super('guitar-practice-web')
    this.version(1).stores({
      songs: 'id, title, importedAt, favorite',
      fretboard: 'id, updatedAt',
      settings: 'key',
    })
  }
}

export const db = new GuitarPracticeDb()

export function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function fileFormat(fileName: string): string {
  const parts = fileName.toLowerCase().split('.')
  return parts.length > 1 ? parts[parts.length - 1] : 'unknown'
}

export async function listSongs(): Promise<SongRecord[]> {
  return db.songs.orderBy('importedAt').reverse().toArray()
}

export async function getSong(id: string): Promise<SongRecord | undefined> {
  return db.songs.get(id)
}

export async function saveSong(song: SongRecord): Promise<void> {
  await db.songs.put(song)
}

export async function patchSong(
  id: string,
  patch: Partial<Omit<SongRecord, 'id'>>,
): Promise<void> {
  await db.songs.update(id, { ...patch, updatedAt: Date.now() })
}

export async function removeSong(id: string): Promise<void> {
  await db.songs.delete(id)
}

export async function getFretboardProgress(
  id: string,
): Promise<FretboardProgressRecord | undefined> {
  return db.fretboard.get(id)
}

export async function saveFretboardProgress(
  record: FretboardProgressRecord,
): Promise<void> {
  await db.fretboard.put(record)
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const record = await db.settings.get(key)
  return record ? (record.value as T) : fallback
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value })
}
