export type AppTab = 'score' | 'fretboard' | 'settings'

export interface SongRecord {
  id: string
  title: string
  fileName: string
  format: string
  size: number
  data: ArrayBuffer
  importedAt: number
  updatedAt: number
  favorite: 0 | 1
  lastTick: number
  playbackSpeed: number
  loopStart: number | null
  loopEnd: number | null
  selectedTrackIndexes: number[]
  lastPage?: number
}

export interface FretboardProgressRecord {
  id: string
  attempts: number
  correct: number
  wrong: number
  streak: number
  bestStreak: number
  totalResponseMs: number
  completed?: number
  updatedAt: number
}

export interface PitchResult {
  frequency: number | null
  midi: number | null
  note: string | null
  octave: number | null
  cents: number
  confidence: number
  rms: number
}

export interface TranscribedNote {
  pitchMidi: number
  startTimeSeconds: number
  durationSeconds: number
  amplitude: number
  pitchBends?: number[]
}

export interface TranscribeResult {
  notes: TranscribedNote[]
  midiBytes: Uint8Array
  durationSeconds: number
}
