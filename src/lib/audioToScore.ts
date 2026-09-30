import * as alphaTab from '@coderline/alphatab'
import type { SupportedInstrument } from './instrument'
import type { TranscribedNote } from '../types'

const DIVISIONS = 4
const BEATS_PER_MEASURE = 4
const MEASURE_UNITS = DIVISIONS * BEATS_PER_MEASURE

const INSTRUMENT_LABELS: Record<SupportedInstrument, string> = {
  guitar: 'Guitar',
  bass: 'Bass',
  keyboard: 'Keyboard',
  drums: 'Drums',
}

const INSTRUMENT_PROGRAMS: Record<SupportedInstrument, number> = {
  guitar: 25,
  bass: 33,
  keyboard: 0,
  drums: 0,
}

const PITCH_NAMES = [
  { step: 'C', alter: 0 },
  { step: 'C', alter: 1 },
  { step: 'D', alter: 0 },
  { step: 'D', alter: 1 },
  { step: 'E', alter: 0 },
  { step: 'F', alter: 0 },
  { step: 'F', alter: 1 },
  { step: 'G', alter: 0 },
  { step: 'G', alter: 1 },
  { step: 'A', alter: 0 },
  { step: 'A', alter: 1 },
  { step: 'B', alter: 0 },
] as const

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function durationType(units: number): string {
  if (units <= 1) return '16th'
  if (units <= 2) return 'eighth'
  if (units <= 4) return 'quarter'
  if (units <= 8) return 'half'
  return 'whole'
}

function pitchXml(midi: number): string {
  const value = Math.max(0, Math.min(127, Math.round(midi)))
  const pitch = PITCH_NAMES[value % 12]
  const octave = Math.floor(value / 12) - 1
  return `<pitch><step>${pitch.step}</step>${
    pitch.alter ? `<alter>${pitch.alter}</alter>` : ''
  }<octave>${octave}</octave></pitch>`
}

function noteXml(
  midi: number,
  units: number,
  options: { chord?: boolean; tieStart?: boolean; tieStop?: boolean } = {},
): string {
  return `<note>${
    options.chord ? '<chord/>' : ''
  }${pitchXml(midi)}<duration>${units}</duration>${
    options.tieStart ? '<tie type="start"/>' : ''
  }<voice>1</voice><type>${durationType(units)}</type>${
    options.tieStop ? '<tie type="stop"/>' : ''
  }</note>`
}

function restXml(units: number): string {
  return `<note><rest/><duration>${units}</duration><voice>1</voice><type>${durationType(
    units,
  )}</type></note>`
}

export function notesToMusicXml(
  notes: TranscribedNote[],
  title: string,
  bpm = 120,
): string {
  const quarterSeconds = 60 / Math.max(30, bpm)
  const groups = new Map<number, { midis: number[]; units: number }>()

  for (const note of notes) {
    const start = Math.max(
      0,
      Math.round((note.startTimeSeconds / quarterSeconds) * DIVISIONS),
    )
    const units = Math.max(
      1,
      Math.round((note.durationSeconds / quarterSeconds) * DIVISIONS),
    )
    const current = groups.get(start) ?? { midis: [], units }
    current.midis.push(Math.round(note.pitchMidi))
    current.units = Math.min(current.units, units)
    groups.set(start, current)
  }

  const events = [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, value], index, sorted) => {
      const nextStart = sorted[index + 1]?.[0] ?? Number.POSITIVE_INFINITY
      const clipped = Math.max(1, Math.min(value.units, nextStart - start))
      return {
        start,
        units: Number.isFinite(clipped) ? clipped : value.units,
        midis: [...new Set(value.midis)].sort((a, b) => a - b),
      }
    })

  const measures: string[] = []
  let measureNumber = 1
  let position = 0
  let elements: string[] = []

  function finishMeasure() {
    measures.push(
      `<measure number="${measureNumber}">${
        measureNumber === 1
          ? `<attributes><divisions>${DIVISIONS}</divisions><key><fifths>0</fifths></key><time><beats>${BEATS_PER_MEASURE}</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>`
          : ''
      }${elements.join('')}</measure>`,
    )
    measureNumber += 1
    elements = []
  }

  function ensureMeasure() {
    if (position > 0 && position % MEASURE_UNITS === 0) finishMeasure()
  }

  function addRest(units: number) {
    let remaining = units
    while (remaining > 0) {
      const available = MEASURE_UNITS - (position % MEASURE_UNITS)
      const chunk = Math.min(remaining, available)
      elements.push(restXml(chunk))
      position += chunk
      remaining -= chunk
      ensureMeasure()
    }
  }

  function addChord(midis: number[], units: number) {
    let remaining = units
    let tieStop = false
    while (remaining > 0) {
      const available = MEASURE_UNITS - (position % MEASURE_UNITS)
      const chunk = Math.min(remaining, available)
      const tieStart = remaining > chunk
      midis.forEach((midi, index) => {
        elements.push(
          noteXml(midi, chunk, {
            chord: index > 0,
            tieStart,
            tieStop,
          }),
        )
      })
      position += chunk
      remaining -= chunk
      tieStop = tieStart
      ensureMeasure()
    }
  }

  if (events.length === 0) {
    elements.push(restXml(MEASURE_UNITS))
    position = MEASURE_UNITS
    finishMeasure()
  } else {
    for (const event of events) {
      if (event.start > position) addRest(event.start - position)
      addChord(event.midis, event.units)
    }
    if (position % MEASURE_UNITS !== 0) finishMeasure()
  }

  const safeTitle = escapeXml(title || '音频转谱')
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <movement-title>${safeTitle}</movement-title>
  <identification><creator type="composer">Audio transcription</creator></identification>
  <part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list>
  <part id="P1">${measures.join('')}</part>
</score-partwise>`
}

export function notesToGpScore(
  notes: TranscribedNote[],
  title: string,
  bpm = 120,
  instrument: SupportedInstrument = 'guitar',
): { bytes: Uint8Array; xml: string } {
  const xml = notesToMusicXml(notes, title, bpm)
  const settings = new alphaTab.Settings()
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(
    new TextEncoder().encode(xml),
    settings,
  )
  score.title = title || score.title
  applyInstrument(score, instrument)
  const bytes = new alphaTab.exporter.Gp7Exporter().export(score, settings)
  return { bytes, xml }
}

function applyInstrument(
  score: alphaTab.model.Score,
  instrument: SupportedInstrument,
): void {
  const track = score.tracks[0]
  if (!track) return
  track.name = INSTRUMENT_LABELS[instrument]
  track.playbackInfo.program = INSTRUMENT_PROGRAMS[instrument]

  const staff = track.staves[0]
  if (!staff) return

  const usesTab = instrument === 'guitar' || instrument === 'bass'
  if (!usesTab) {
    staff.showTablature = false
    staff.showStandardNotation = true
    return
  }

  const lowToHigh =
    instrument === 'guitar' ? [40, 45, 50, 55, 59, 64] : [28, 33, 38, 43]
  staff.stringTuning.tunings = [...lowToHigh].reverse()
  staff.showTablature = true
  staff.showStandardNotation = false

  for (const bar of staff.bars) {
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        for (const note of beat.notes) {
          let bestString = 0
          let bestFret = Number.POSITIVE_INFINITY
          lowToHigh.forEach((openMidi, stringIndex) => {
            const fret = Math.round(note.realValue) - openMidi
            if (fret >= 0 && fret <= 24 && fret < bestFret) {
              bestString = stringIndex + 1
              bestFret = fret
            }
          })
          if (bestString > 0 && Number.isFinite(bestFret)) {
            note.string = bestString
            note.fret = bestFret
          }
        }
      }
    }
  }
}
