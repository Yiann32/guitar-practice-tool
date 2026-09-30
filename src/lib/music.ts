export const SHARP_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const

export const FLAT_NAMES = [
  'C',
  'Db',
  'D',
  'Eb',
  'E',
  'F',
  'Gb',
  'G',
  'Ab',
  'A',
  'Bb',
  'B',
] as const

export const STANDARD_TUNING = [40, 45, 50, 55, 59, 64]

export interface TuningPreset {
  id: string
  name: string
  strings: number[]
}

export type FretInstrument = 'guitar' | 'bass'

export const TUNING_PRESETS: TuningPreset[] = [
  { id: 'standard', name: '标准 EADGBE', strings: STANDARD_TUNING },
  { id: 'drop-d', name: 'Drop D', strings: [38, 45, 50, 55, 59, 64] },
  { id: 'eb-standard', name: 'Eb 标准', strings: [39, 44, 49, 54, 58, 63] },
  { id: 'd-standard', name: 'D 标准', strings: [38, 43, 48, 53, 57, 62] },
  { id: 'open-g', name: 'Open G', strings: [38, 43, 50, 55, 59, 62] },
  { id: 'open-d', name: 'Open D', strings: [38, 45, 50, 54, 57, 62] },
  { id: 'dadgad', name: 'DADGAD', strings: [38, 45, 50, 55, 57, 62] },
]

export const BASS_TUNING_PRESETS: TuningPreset[] = [
  { id: 'bass-standard', name: '贝斯 EADG', strings: [28, 33, 38, 43] },
  { id: 'bass-drop-d', name: '贝斯 Drop D', strings: [26, 33, 38, 43] },
  { id: 'bass-five', name: '五弦贝斯 BEADG', strings: [23, 28, 33, 38, 43] },
  { id: 'bass-eb', name: '贝斯 Eb 标准', strings: [27, 32, 37, 42] },
]

export const TUNING_PRESETS_BY_INSTRUMENT: Record<FretInstrument, TuningPreset[]> = {
  guitar: TUNING_PRESETS,
  bass: BASS_TUNING_PRESETS,
}

export const INSTRUMENT_PITCH_RANGES: Record<
  FretInstrument,
  { minHz: number; maxHz: number }
> = {
  guitar: { minHz: 70, maxHz: 1400 },
  bass: { minHz: 28, maxHz: 520 },
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

export function frequencyToMidiFloat(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440)
}

export function midiToNoteName(midi: number, preferFlat = false): string {
  const names = preferFlat ? FLAT_NAMES : SHARP_NAMES
  const pc = ((Math.round(midi) % 12) + 12) % 12
  return names[pc]
}

export function midiToFullName(midi: number, preferFlat = false): string {
  const rounded = Math.round(midi)
  return `${midiToNoteName(rounded, preferFlat)}${Math.floor(rounded / 12) - 1}`
}

export function pitchClass(midi: number): number {
  return ((Math.round(midi) % 12) + 12) % 12
}

export function noteNameToMidi(input: string): number | null {
  const match = input.trim().match(/^([A-Ga-g])([#b♯♭]?)(-?\d+)$/)
  if (!match) return null
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
  const letter = match[1].toUpperCase()
  const accidental = match[2]
  const octave = Number(match[3])
  let pc = base[letter]
  if (accidental === '#' || accidental === '♯') pc += 1
  if (accidental === 'b' || accidental === '♭') pc -= 1
  return (octave + 1) * 12 + pc
}

export function parseCustomTuning(input: string): number[] | null {
  const values = input
    .split(/[\s,，、]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map(noteNameToMidi)
  if (values.length < 4 || values.length > 6 || values.some((value) => value === null)) {
    return null
  }
  return values as number[]
}

export function fretToMidi(
  tuning: number[],
  stringIndex: number,
  fret: number,
): number {
  return tuning[stringIndex] + fret
}

export interface FretPosition {
  stringIndex: number
  fret: number
}

export function findFretPositions(
  midi: number,
  tuning: number[],
  maxFret: number,
): FretPosition[] {
  const result: FretPosition[] = []
  for (let stringIndex = 0; stringIndex < tuning.length; stringIndex += 1) {
    const fret = midi - tuning[stringIndex]
    if (fret >= 0 && fret <= maxFret) {
      result.push({ stringIndex, fret })
    }
  }
  return result
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const remainder = total % 60
  return `${minutes}:${remainder.toString().padStart(2, '0')}`
}
