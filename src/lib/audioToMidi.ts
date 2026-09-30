import {
  addPitchBendsToNoteEvents,
  BasicPitch,
  noteFramesToTime,
  outputToNotesPoly,
} from '@spotify/basic-pitch'
import { Midi } from '@tonejs/midi'
import type { TranscribedNote, TranscribeResult } from '../types'
import { clamp } from './music'
import { saveOrShareFile } from './nativeFile'

const MODEL_URL = '/models/basic-pitch/model.json'
const TARGET_SAMPLE_RATE = 22050
const MAX_AUDIO_SECONDS = 300

function mergeAdjacentNotes(notes: TranscribedNote[]): TranscribedNote[] {
  const sorted = [...notes].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)
  const merged: TranscribedNote[] = []
  for (const note of sorted) {
    const previous = merged[merged.length - 1]
    const previousEnd = previous
      ? previous.startTimeSeconds + previous.durationSeconds
      : Number.NEGATIVE_INFINITY
    if (
      previous &&
      previous.pitchMidi === note.pitchMidi &&
      note.startTimeSeconds <= previousEnd + 0.08
    ) {
      previous.durationSeconds = Math.max(
        previous.durationSeconds,
        note.startTimeSeconds + note.durationSeconds - previous.startTimeSeconds,
      )
      previous.amplitude = Math.max(previous.amplitude, note.amplitude)
      if (!previous.pitchBends && note.pitchBends) previous.pitchBends = note.pitchBends
    } else {
      merged.push({ ...note })
    }
  }
  return merged
}

async function decodeToMono22050(file: File): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer()
  const decodeContext = new AudioContext()
  try {
    const decoded = await decodeContext.decodeAudioData(arrayBuffer.slice(0))
    if (decoded.duration > MAX_AUDIO_SECONDS) {
      throw new Error(`音频超过 ${MAX_AUDIO_SECONDS / 60} 分钟，请先裁剪后再转写。`)
    }
    const frameCount = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE))
    const offline = new OfflineAudioContext(1, frameCount, TARGET_SAMPLE_RATE)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start()
    return await offline.startRendering()
  } finally {
    await decodeContext.close()
  }
}

export async function transcribeAudio(
  file: File,
  onProgress: (progress: number) => void,
): Promise<TranscribeResult> {
  const audioBuffer = await decodeToMono22050(file)
  const frames: number[][] = []
  const onsets: number[][] = []
  const contours: number[][] = []
  const basicPitch = new BasicPitch(MODEL_URL)

  await basicPitch.evaluateModel(
    audioBuffer,
    (frameBatch, onsetBatch, contourBatch) => {
      frames.push(...frameBatch)
      onsets.push(...onsetBatch)
      contours.push(...contourBatch)
    },
    onProgress,
  )

  const noteEvents = outputToNotesPoly(frames, onsets, 0.25, 0.25, 5)
  const notesWithBends = addPitchBendsToNoteEvents(contours, noteEvents)
  const notes: TranscribedNote[] = mergeAdjacentNotes(
    noteFramesToTime(notesWithBends)
    .filter(
      (note) =>
        Number.isFinite(note.pitchMidi) &&
        Number.isFinite(note.startTimeSeconds) &&
        note.durationSeconds > 0.03,
    )
    .map((note) => ({
      pitchMidi: Math.round(note.pitchMidi),
      startTimeSeconds: note.startTimeSeconds,
      durationSeconds: note.durationSeconds,
      amplitude: note.amplitude,
      pitchBends: note.pitchBends,
    })),
  )

  const midiBytes = notesToMidi(notes, 120)
  return {
    notes,
    midiBytes,
    durationSeconds: audioBuffer.duration,
  }
}

export function notesToMidi(notes: TranscribedNote[], bpm: number): Uint8Array {
  const midi = new Midi()
  midi.header.setTempo(bpm)
  midi.header.timeSignatures.push({
    ticks: 0,
    timeSignature: [4, 4],
    measures: 0,
  })
  const track = midi.addTrack()
  track.name = 'Audio transcription'
  track.channel = 0
  track.instrument.number = 24

  for (const note of notes) {
    track.addNote({
      midi: clamp(note.pitchMidi, 0, 127),
      time: Math.max(0, note.startTimeSeconds),
      duration: Math.max(0.04, note.durationSeconds),
      velocity: clamp(0.25 + note.amplitude, 0.25, 1),
    })
  }

  return midi.toArray()
}

export async function downloadMidi(
  bytes: Uint8Array,
  fileName = 'transcription.mid',
): Promise<void> {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
  await saveOrShareFile(new Blob([buffer], { type: 'audio/midi' }), fileName)
}
