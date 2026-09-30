declare module '@spotify/basic-pitch' {
  export interface NoteEvent {
    startFrame: number
    durationFrames: number
    pitchMidi: number
    amplitude: number
    pitchBends?: number[]
  }

  export interface NoteEventTime {
    startTimeSeconds: number
    durationSeconds: number
    pitchMidi: number
    amplitude: number
    pitchBends?: number[]
  }

  export class BasicPitch {
    constructor(modelOrModelPath: string)
    evaluateModel(
      buffer: AudioBuffer | Float32Array,
      onComplete: (
        frames: number[][],
        onsets: number[][],
        contours: number[][],
      ) => void,
      percentCallback: (percent: number) => void,
    ): Promise<void>
  }

  export function outputToNotesPoly(
    frames: number[][],
    onsets: number[][],
    onsetThresh?: number,
    frameThresh?: number,
    minNoteLen?: number,
    inferOnsets?: boolean,
    maxFreq?: number | null,
    minFreq?: number | null,
    melodiaTrick?: boolean,
    energyTolerance?: number,
  ): NoteEvent[]

  export function addPitchBendsToNoteEvents(
    contours: number[][],
    notes: NoteEvent[],
    nBinsTolerance?: number,
  ): NoteEvent[]

  export function noteFramesToTime(notes: NoteEvent[]): NoteEventTime[]
}
