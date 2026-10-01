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

export interface ChordType {
  id: string
  name: string
  suffix: string
  intervals: number[]
}

export const CHORD_TYPES: ChordType[] = [
  { id: 'major', name: '大三和弦', suffix: '', intervals: [0, 4, 7] },
  { id: 'minor', name: '小三和弦', suffix: 'm', intervals: [0, 3, 7] },
  { id: 'power', name: '强力和弦', suffix: '5', intervals: [0, 7, 12] },
  { id: 'sus2', name: '挂二和弦 sus2', suffix: 'sus2', intervals: [0, 2, 7] },
  { id: 'sus4', name: '挂四和弦 sus4', suffix: 'sus4', intervals: [0, 5, 7] },
  { id: 'six', name: '六和弦', suffix: '6', intervals: [0, 4, 7, 9] },
  { id: 'min6', name: '小六和弦', suffix: 'm6', intervals: [0, 3, 7, 9] },
  { id: 'add9', name: '加九和弦 add9', suffix: 'add9', intervals: [0, 4, 7, 14] },
  { id: 'dom7', name: '属七和弦', suffix: '7', intervals: [0, 4, 7, 10] },
  { id: 'maj7', name: '大七和弦', suffix: 'maj7', intervals: [0, 4, 7, 11] },
  { id: 'min7', name: '小七和弦', suffix: 'm7', intervals: [0, 3, 7, 10] },
  { id: 'dom9', name: '属九和弦 9', suffix: '9', intervals: [0, 4, 7, 10, 14] },
  { id: 'sevenSus4', name: '七挂四 7sus4', suffix: '7sus4', intervals: [0, 5, 7, 10] },
  { id: 'halfDim', name: '半减七 m7♭5', suffix: 'm7♭5', intervals: [0, 3, 6, 10] },
  { id: 'dim7', name: '减七 dim7', suffix: 'dim7', intervals: [0, 3, 6, 9] },
  { id: 'aug', name: '增三和弦 aug', suffix: 'aug', intervals: [0, 4, 8] },
]

export interface ChordShapeNote {
  stringIndex: number
  fret: number
  pitchClass: number
}

function chordShapeAt(
  tuning: number[],
  rootPc: number,
  intervals: number[],
  span: number,
  base: number,
): ChordShapeNote[] {
  const toneSet = new Set(intervals.map((interval) => pitchClass(rootPc + interval)))
  const shape: ChordShapeNote[] = []
  tuning.forEach((stringMidi, stringIndex) => {
    const maxFret = base + span
    if (stringIndex > 0 && base <= 2 && toneSet.has(pitchClass(stringMidi))) {
      shape.push({ stringIndex, fret: 0, pitchClass: pitchClass(stringMidi) })
      return
    }
    let chosen = -1
    for (let fret = Math.max(0, stringIndex === 0 ? 0 : base); fret <= maxFret; fret += 1) {
      const pc = pitchClass(stringMidi + fret)
      if (!toneSet.has(pc)) continue
      if (chosen < 0) chosen = fret
      if (stringIndex === 0 && pc === rootPc) {
        chosen = fret
        break
      }
    }
    if (chosen >= 0) {
      shape.push({ stringIndex, fret: chosen, pitchClass: pitchClass(stringMidi + chosen) })
    }
  })
  return shape
}

/**
 * 推导一个便于按奏的和弦指法：在若干候选把位中挑选“覆盖和弦音最多、
 * 尽量低把位、低音优先落在根音”的那一组，未用到的弦视为闷弦。
 */
export function buildChordShape(
  tuning: number[],
  rootPc: number,
  intervals: number[],
  maxFret: number,
  span = 4,
): ChordShapeNote[] {
  const toneCount = new Set(intervals.map((interval) => pitchClass(rootPc + interval))).size
  const limit = Math.max(0, Math.min(maxFret, 15) - span)
  let best: ChordShapeNote[] = []
  let bestScore = Number.NEGATIVE_INFINITY
  for (let base = 0; base <= limit; base += 1) {
    const shape = chordShapeAt(tuning, rootPc, intervals, span, base)
    if (shape.length === 0) continue
    const covered = new Set(shape.map((note) => note.pitchClass)).size
    const rootInBass = shape[0]?.pitchClass === rootPc ? 6 : 0
    const score = covered * 100 + rootInBass - base * 2
    if (score > bestScore || (score === bestScore && covered === toneCount)) {
      bestScore = score
      best = shape
    }
  }
  return best
}
