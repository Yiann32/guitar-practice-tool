import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { db } from '../data/db'
import type { FretboardProgressRecord, SongRecord } from '../types'
import { saveOrShareFile } from './nativeFile'

interface BackupSongMeta extends Omit<SongRecord, 'data'> {
  dataFile: string
}

interface BackupData {
  formatVersion: 1
  exportedAt: string
  songs: BackupSongMeta[]
  fretboard: FretboardProgressRecord[]
  settings: { key: string; value: unknown }[]
}

export async function exportBackup(): Promise<Blob> {
  const songs = await db.songs.toArray()
  const fretboard = await db.fretboard.toArray()
  const settings = await db.settings.toArray()
  const files: Record<string, Uint8Array> = {}

  const songMetas: BackupSongMeta[] = songs.map((song) => {
    const { data, ...meta } = song
    const dataFile = `songs/${song.id}.bin`
    files[dataFile] = new Uint8Array(data)
    return { ...meta, dataFile }
  })

  const data: BackupData = {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    songs: songMetas,
    fretboard,
    settings,
  }

  files['manifest.json'] = strToU8(
    JSON.stringify(
      {
        app: 'guitar-practice-web',
        formatVersion: 1,
        exportedAt: data.exportedAt,
        songCount: songs.length,
      },
      null,
      2,
    ),
  )
  files['data.json'] = strToU8(JSON.stringify(data, null, 2))

  return new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' })
}

export async function importBackup(file: File): Promise<number> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const archive = unzipSync(bytes)
  const dataFile = archive['data.json']
  if (!dataFile) throw new Error('备份包缺少 data.json。')

  const data = JSON.parse(strFromU8(dataFile)) as BackupData
  if (data.formatVersion !== 1) throw new Error(`不支持的备份版本：${data.formatVersion}`)

  let imported = 0
  for (const meta of data.songs) {
    const songData = archive[meta.dataFile]
    if (!songData) continue
    const buffer = songData.buffer.slice(
      songData.byteOffset,
      songData.byteOffset + songData.byteLength,
    ) as ArrayBuffer
    await db.songs.put({ ...meta, data: buffer })
    imported += 1
  }

  if (Array.isArray(data.fretboard)) {
    await db.fretboard.bulkPut(data.fretboard)
  }
  if (Array.isArray(data.settings)) {
    await db.settings.bulkPut(data.settings)
  }
  return imported
}

export async function downloadBlob(blob: Blob, fileName: string): Promise<void> {
  await saveOrShareFile(blob, fileName)
}
