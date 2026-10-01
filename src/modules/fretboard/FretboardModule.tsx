import { useEffect, useRef, useState } from 'react'
import {
  buildChordShape,
  CHORD_TYPES,
  findFretPositions,
  midiToFullName,
  midiToNoteName,
  parseCustomTuning,
  pitchClass,
  INSTRUMENT_PITCH_RANGES,
  TUNING_PRESETS_BY_INSTRUMENT,
  type ChordShapeNote,
  type FretInstrument,
} from '../../lib/music'
import { detectPitchYin, rmsToDb } from '../../lib/pitch'
import { getFretboardProgress, saveFretboardProgress } from '../../data/db'
import type { FretboardProgressRecord, PitchResult } from '../../types'

type PracticeMode = 'note' | 'scale' | 'chord'
type NoteSet = 'all' | 'natural' | 'accidental'
type ScaleDirection = 'up' | 'down' | 'updown'

interface ScaleDefinition {
  id: string
  name: string
  intervals: number[]
}

interface Question {
  mode: PracticeMode
  targetMidi: number
  stringIndex: number
  fret: number
  scaleName?: string
}

interface ScaleStep {
  targetMidi: number
  stringIndex: number
  fret: number
}

interface ChordQuestion {
  rootPc: number
  name: string
  tones: number[]
  shape: ChordShapeNote[]
  progressionName: string
  index: number
  total: number
}

interface ChordProgression {
  id: string
  name: string
  /** 相对根音的半音偏移；typeId 留空则沿用「和弦类型」里选择的类型。 */
  steps: Array<{ offset: number; typeId?: string }>
  hint?: string
}

const CHORD_PROGRESSIONS: ChordProgression[] = [
  { id: 'single', name: '单和弦循环', steps: [{ offset: 0 }] },
  { id: 'pop', name: '流行 I–V–vi–IV', steps: [{ offset: 0 }, { offset: 7 }, { offset: 9 }, { offset: 5 }] },
  {
    id: 'fifties',
    name: '50 年代 I–vi–IV–V',
    steps: [{ offset: 0 }, { offset: 9 }, { offset: 5 }, { offset: 7 }],
  },
  { id: 'blues', name: '布鲁斯 I–IV–V', steps: [{ offset: 0 }, { offset: 5 }, { offset: 7 }] },
  {
    id: 'canon',
    name: '卡农进行 I–V–vi–iii–IV–I–IV–V',
    steps: [
      { offset: 0 },
      { offset: 7 },
      { offset: 9 },
      { offset: 4 },
      { offset: 5 },
      { offset: 0 },
      { offset: 5 },
      { offset: 7 },
    ],
  },
  {
    id: 'oudou',
    name: '王道進行 4-5-3-6',
    steps: [
      { offset: 5, typeId: 'maj7' },
      { offset: 7, typeId: 'dom7' },
      { offset: 4, typeId: 'min7' },
      { offset: 9, typeId: 'min7' },
    ],
    hint: 'IV△7–V7–iii7–vi，日系流行最常用的进行',
  },
  {
    id: 'marunouchi',
    name: '丸の内進行 4-5-3-6（三和音）',
    steps: [{ offset: 5 }, { offset: 7 }, { offset: 4 }, { offset: 9 }],
    hint: '与王道進行的度数相同，改用三和弦、色彩更干净',
  },
  {
    id: 'oudou251',
    name: '王道進行扩展 4-5-3-6-2-5-1',
    steps: [
      { offset: 5, typeId: 'maj7' },
      { offset: 7, typeId: 'dom7' },
      { offset: 4, typeId: 'min7' },
      { offset: 9, typeId: 'min7' },
      { offset: 2, typeId: 'min7' },
      { offset: 7, typeId: 'dom7' },
      { offset: 0, typeId: 'maj7' },
    ],
    hint: '在王道進行后面接 ii–V–I 收尾',
  },
  {
    id: 'komuro',
    name: '小室進行 6-4-5-1',
    steps: [
      { offset: 9, typeId: 'min7' },
      { offset: 5, typeId: 'maj7' },
      { offset: 7, typeId: 'dom7' },
      { offset: 0, typeId: 'maj7' },
    ],
    hint: 'vi–IV–V–I，90 年代 J-Pop 的标志性进行',
  },
  {
    id: 'jpop-canon',
    name: '日系卡农 1-5-6-3-4-1-4-5',
    steps: [
      { offset: 0, typeId: 'maj7' },
      { offset: 7, typeId: 'dom7' },
      { offset: 9, typeId: 'min7' },
      { offset: 4, typeId: 'min7' },
      { offset: 5, typeId: 'maj7' },
      { offset: 0, typeId: 'maj7' },
      { offset: 5, typeId: 'maj7' },
      { offset: 7, typeId: 'dom7' },
    ],
    hint: 'I△7–V7–vi7–iii7–IV△7–I△7–IV△7–V7',
  },
]

const SCALES: ScaleDefinition[] = [
  { id: 'major', name: '大调', intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor', name: '自然小调', intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'major-pentatonic', name: '大调五声', intervals: [0, 2, 4, 7, 9] },
  { id: 'minor-pentatonic', name: '小调五声', intervals: [0, 3, 5, 7, 10] },
  { id: 'blues', name: '小调布鲁斯', intervals: [0, 3, 5, 6, 7, 10] },
]

const FRET_RANGES = [
  { id: 'low', label: '低把位 0–4 品', min: 0, max: 4 },
  { id: 'mid', label: '中把位 5–8 品', min: 5, max: 8 },
  { id: 'high', label: '高把位 9–15 品', min: 9, max: 15 },
  { id: 'full15', label: '全指板 0–15 品', min: 0, max: 15 },
  { id: 'full24', label: '全指板 0–24 品', min: 0, max: 24 },
] as const

function defaultProgress(id: string): FretboardProgressRecord {
  return {
    id,
    attempts: 0,
    correct: 0,
    wrong: 0,
    streak: 0,
    bestStreak: 0,
    totalResponseMs: 0,
    completed: 0,
    updatedAt: Date.now(),
  }
}

function randomOf<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

function noteMatches(
  heardMidi: number,
  targetMidi: number,
  exactOctave: boolean,
): boolean {
  return exactOctave ? heardMidi === targetMidi : pitchClass(heardMidi) === pitchClass(targetMidi)
}

interface FretTarget {
  stringIndex: number
  fret: number
  label?: string
  done?: boolean
}

interface FretboardSvgProps {
  tuning: number[]
  maxFret: number
  targets: FretTarget[]
  targetsVisible: boolean
  detected: { stringIndex: number; fret: number }[]
}

function FretboardSvg({
  tuning,
  maxFret,
  targets,
  targetsVisible,
  detected,
}: FretboardSvgProps) {
  const left = 58
  const top = 30
  const fretGap = 34
  const stringGap = 38
  const stringCount = tuning.length
  const boardHeight = stringGap * (stringCount - 1) + 26
  const width = left + maxFret * fretGap + 46
  const height = top * 2 + stringGap * (stringCount - 1) + 26
  const yForString = (stringIndex: number) =>
    top + (stringCount - 1 - stringIndex) * stringGap
  const centerY = top + (stringGap * (stringCount - 1)) / 2
  const xForFret = (fret: number) => left + Math.max(0, fret - 0.5) * fretGap
  const inlays = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24].filter((fret) => fret <= maxFret)

  return (
    <svg
      className="fretboard-svg"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="乐器指板"
    >
      <rect x={left} y={top - 13} width={maxFret * fretGap} height={boardHeight} rx={12} />
      {inlays.map((fret) => (
        <g key={fret}>
          <circle
            cx={left + (fret - 0.5) * fretGap}
            cy={centerY}
            r={4}
            className="inlay"
          />
          {fret === 12 && (
            <circle
              cx={left + (fret - 0.5) * fretGap}
              cy={centerY - stringGap / 2}
              r={4}
              className="inlay"
            />
          )}
        </g>
      ))}
      <rect x={left - 6} y={top - 15} width={7} height={boardHeight + 4} rx={3} className="nut" />
      {Array.from({ length: maxFret + 1 }, (_, fret) => (
        <line
          key={`fret-${fret}`}
          x1={left + fret * fretGap}
          x2={left + fret * fretGap}
          y1={top - 14}
          y2={top + stringGap * (stringCount - 1) + 14}
          className="fret-line"
        />
      ))}
      {tuning.map((midi, stringIndex) => {
        const y = yForString(stringIndex)
        const stringNumber = stringCount - stringIndex
        return (
          <g key={`string-${stringIndex}`}>
            <line x1={left} x2={left + maxFret * fretGap} y1={y} y2={y} className="string-line" />
            <text x={18} y={y + 5} className="fretboard-label">
              {stringNumber}
            </text>
            <text x={36} y={y + 5} className="fretboard-label string-note">
              {midiToNoteName(midi)}
            </text>
          </g>
        )
      })}
      {Array.from({ length: maxFret + 1 }, (_, fret) => (
        <text
          key={`fret-label-${fret}`}
          x={left + fret * fretGap}
          y={height - 8}
          textAnchor="middle"
          className="fretboard-label"
        >
          {fret}
        </text>
      ))}
      {detected.map((position) => (
        <circle
          key={`detected-${position.stringIndex}-${position.fret}`}
          cx={xForFret(position.fret)}
          cy={yForString(position.stringIndex)}
          r={13}
          className="detected-marker"
        />
      ))}
      {targetsVisible &&
        targets.map((target) => (
          <g key={`target-${target.stringIndex}-${target.fret}`}>
            <circle
              cx={xForFret(target.fret)}
              cy={yForString(target.stringIndex)}
              r={14}
              className={`target-marker ${target.done ? 'is-done' : ''}`}
            />
            <text
              x={xForFret(target.fret)}
              y={yForString(target.stringIndex) + 5}
              textAnchor="middle"
              className="marker-text"
            >
              {target.label ?? target.fret}
            </text>
          </g>
        ))}
    </svg>
  )
}

export default function FretboardModule() {
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const animationRef = useRef(0)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const samplesRef = useRef<Float32Array<ArrayBuffer> | null>(null)
  const stableMidiRef = useRef<number | null>(null)
  const stableCountRef = useRef(0)
  const lastJudgementRef = useRef(0)
  const answeredRef = useRef(false)
  const questionRef = useRef<Question | null>(null)
  const lastUiUpdateRef = useRef(0)
  const nextQuestionRef = useRef<() => void>(() => {})
  const scaleSequenceRef = useRef<ScaleStep[]>([])
  const scaleIndexRef = useRef(0)
  const currentScaleChipRef = useRef<HTMLSpanElement | null>(null)
  const chordQuestionRef = useRef<ChordQuestion | null>(null)
  const chordCollectedRef = useRef<number[]>([])
  const chordIndexRef = useRef(0)
  const nextChordRef = useRef<() => void>(() => {})
  const instrumentRef = useRef<FretInstrument>('guitar')

  const [mode, setMode] = useState<PracticeMode>('note')
  const [instrument, setInstrument] = useState<FretInstrument>(() => {
    if (typeof localStorage === 'undefined') return 'guitar'
    return localStorage.getItem('fretboard-instrument') === 'bass' ? 'bass' : 'guitar'
  })
  instrumentRef.current = instrument
  const [tuningId, setTuningId] = useState('standard')
  const [customTuning, setCustomTuning] = useState('E2 A2 D3 G3 B3 E4')
  const [fretRangeId, setFretRangeId] = useState('full15')
  const [minFret, setMinFret] = useState(0)
  const [maxFret, setMaxFret] = useState(15)
  const [noteSet, setNoteSet] = useState<NoteSet>('all')
  const [exactOctave, setExactOctave] = useState(true)
  const [scaleRoot, setScaleRoot] = useState(0)
  const [scaleId, setScaleId] = useState('major')
  const [scaleDirection, setScaleDirection] = useState<ScaleDirection>('updown')
  const [scaleOctaves, setScaleOctaves] = useState(1)
  const [scaleSequence, setScaleSequence] = useState<ScaleStep[]>([])
  const [scaleIndex, setScaleIndex] = useState(0)
  const [chordRoot, setChordRoot] = useState(0)
  const [chordTypeId, setChordTypeId] = useState('major')
  const [progressionId, setProgressionId] = useState('single')
  const [chordQuestion, setChordQuestion] = useState<ChordQuestion | null>(null)
  const [chordCollected, setChordCollected] = useState<number[]>([])
  const [chordVersion, setChordVersion] = useState(0)
  const [question, setQuestion] = useState<Question | null>(null)
  const [questionVersion, setQuestionVersion] = useState(0)
  const [questionStartedAt, setQuestionStartedAt] = useState(Date.now())
  const [revealed, setRevealed] = useState(false)
  const [feedback, setFeedback] = useState('点击“启用麦克风”后开始练习')
  const [feedbackTone, setFeedbackTone] = useState<'idle' | 'correct' | 'wrong'>('idle')
  const [micOn, setMicOn] = useState(false)
  const [pitch, setPitch] = useState<PitchResult | null>(null)
  const [progress, setProgress] = useState<FretboardProgressRecord>(() =>
    defaultProgress('fretboard-note'),
  )

  const customParsed = parseCustomTuning(customTuning)
  const presets = TUNING_PRESETS_BY_INSTRUMENT[instrument]
  const preset = presets.find((item) => item.id === tuningId)
  const tuning =
    tuningId === 'custom'
      ? customParsed ?? presets[0].strings
      : preset?.strings ?? presets[0].strings

  useEffect(() => {
    const nextPresets = TUNING_PRESETS_BY_INSTRUMENT[instrument]
    setTuningId(nextPresets[0].id)
    setCustomTuning(
      instrument === 'bass' ? 'E1 A1 D2 G2' : 'E2 A2 D3 G3 B3 E4',
    )
    localStorage.setItem('fretboard-instrument', instrument)
  }, [instrument])

  const progressId =
    mode === 'scale' ? 'fretboard-scale' : mode === 'chord' ? 'fretboard-chord' : 'fretboard-note'

  useEffect(() => {
    void getFretboardProgress(progressId).then((saved) => {
      setProgress(saved ?? defaultProgress(progressId))
    })
  }, [progressId])

  useEffect(() => {
    void saveFretboardProgress(progress)
  }, [progress])

  useEffect(() => {
    if (mode !== 'scale') return
    currentScaleChipRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    })
  }, [mode, scaleIndex, scaleSequence])

  function buildScaleSequence(): ScaleStep[] {
    const scale = SCALES.find((item) => item.id === scaleId) ?? SCALES[0]
    const minMidi = tuning[0]
    const maxMidi = tuning[tuning.length - 1] + maxFret
    let root = scaleRoot
    while (root < minMidi) root += 12

    const ascending: number[] = []
    for (let octave = 0; octave < scaleOctaves; octave += 1) {
      for (const interval of scale.intervals) {
        ascending.push(root + octave * 12 + interval)
      }
    }
    ascending.push(root + scaleOctaves * 12)

    const midis =
      scaleDirection === 'up'
        ? ascending
        : scaleDirection === 'down'
          ? [...ascending].reverse()
          : [...ascending, ...ascending.slice(0, -1).reverse()]

    const steps: ScaleStep[] = []
    for (const midi of midis) {
      if (midi < minMidi || midi > maxMidi) continue
      const positions = findFretPositions(midi, tuning, maxFret).filter(
        (position) => position.fret >= minFret && position.fret <= maxFret,
      )
      if (positions.length === 0) continue
      const position = [...positions].sort((a, b) => a.fret - b.fret)[0]
      steps.push({ targetMidi: midi, ...position })
    }
    if (steps.length >= 4) return steps

    const fallback: ScaleStep[] = []
    for (const midi of midis) {
      if (midi < minMidi || midi > maxMidi) continue
      const positions = findFretPositions(midi, tuning, 15).filter(
        (position) => position.fret <= 15,
      )
      if (positions.length === 0) continue
      const position = [...positions].sort((a, b) => a.fret - b.fret)[0]
      fallback.push({ targetMidi: midi, ...position })
    }
    return fallback
  }

  function scaleTitle(): string {
    const scale = SCALES.find((item) => item.id === scaleId) ?? SCALES[0]
    return `${midiToNoteName(scaleRoot)} ${scale.name}`
  }

  function createQuestion(): Question | null {
    if (mode === 'scale') {
      const step = scaleSequenceRef.current[scaleIndexRef.current]
      return step ? { mode: 'scale', scaleName: scaleTitle(), ...step } : null
    }

    const candidates: Array<{ stringIndex: number; fret: number; targetMidi: number }> = []
    for (let stringIndex = 0; stringIndex < tuning.length; stringIndex += 1) {
      for (let fret = minFret; fret <= maxFret; fret += 1) {
        const midi = tuning[stringIndex] + fret
        const pc = pitchClass(midi)
        const natural = [0, 2, 4, 5, 7, 9, 11].includes(pc)
        if (noteSet === 'natural' && !natural) continue
        if (noteSet === 'accidental' && natural) continue
        candidates.push({ stringIndex, fret, targetMidi: midi })
      }
    }
    if (candidates.length === 0) return null
    return { mode, ...randomOf(candidates) }
  }

  function setQuestionState(next: Question | null, message?: string) {
    setQuestion(next)
    setQuestionVersion((value) => value + 1)
    questionRef.current = next
    setQuestionStartedAt(Date.now())
    setRevealed(false)
    answeredRef.current = false
    stableMidiRef.current = null
    stableCountRef.current = 0
    setFeedback(next ? message ?? '听音中，弹响目标音即可判定' : '当前筛选没有可用题目')
    setFeedbackTone('idle')
  }

  function beginScaleSequence() {
    const sequence = buildScaleSequence()
    scaleSequenceRef.current = sequence
    scaleIndexRef.current = 0
    setScaleSequence(sequence)
    setScaleIndex(0)
    const first = sequence[0]
    setQuestionState(
      first ? { mode: 'scale', scaleName: scaleTitle(), ...first } : null,
      '按顺序弹奏音阶，每个音弹准后自动进入下一个',
    )
  }

  function nextQuestion() {
    if (mode === 'chord') {
      nextChord()
      return
    }
    if (mode === 'scale') {
      const sequence = scaleSequenceRef.current
      if (sequence.length === 0) {
        beginScaleSequence()
        return
      }
      const nextIndex = (scaleIndexRef.current + 1) % sequence.length
      scaleIndexRef.current = nextIndex
      setScaleIndex(nextIndex)
      const step = sequence[nextIndex]
      setQuestionState({ mode: 'scale', scaleName: scaleTitle(), ...step })
      return
    }
    setQuestionState(createQuestion())
  }

  nextQuestionRef.current = nextQuestion

  function buildChordQuestion(index: number): ChordQuestion | null {
    const progression =
      CHORD_PROGRESSIONS.find((item) => item.id === progressionId) ?? CHORD_PROGRESSIONS[0]
    const step = progression.steps[index % progression.steps.length]
    const type =
      CHORD_TYPES.find((item) => item.id === (step.typeId ?? chordTypeId)) ?? CHORD_TYPES[0]
    const rootPc = pitchClass(chordRoot + step.offset)
    const shape = buildChordShape(tuning, rootPc, type.intervals, maxFret)
    if (shape.length === 0) return null
    const shapeTones = [...new Set(shape.map((note) => note.pitchClass))]
    return {
      rootPc,
      name: `${midiToNoteName(rootPc)}${type.suffix}`,
      tones: [rootPc, ...shapeTones.filter((pc) => pc !== rootPc)],
      shape,
      progressionName: progression.name,
      index,
      total: progression.steps.length,
    }
  }

  function startChordPractice(index: number) {
    const next = buildChordQuestion(index)
    chordIndexRef.current = index
    chordQuestionRef.current = next
    chordCollectedRef.current = []
    setChordQuestion(next)
    setChordCollected([])
    setChordVersion((value) => value + 1)
    setQuestionStartedAt(Date.now())
    setRevealed(true)
    setFeedbackTone('idle')
    stableMidiRef.current = null
    stableCountRef.current = 0
    setFeedback(
      next
        ? '逐个弹出高亮标记的和弦音，识别到就会打勾；分解和弦或反复扫弦都可以'
        : '当前设置推导不出指法，请调整把位或调弦',
    )
  }

  function nextChord() {
    const progression =
      CHORD_PROGRESSIONS.find((item) => item.id === progressionId) ?? CHORD_PROGRESSIONS[0]
    const nextIndex = (chordIndexRef.current + 1) % progression.steps.length
    startChordPractice(nextIndex)
  }

  nextChordRef.current = nextChord

  useEffect(() => {
    if (mode === 'scale') {
      beginScaleSequence()
      return
    }
    if (mode === 'chord') {
      startChordPractice(0)
      return
    }
    nextQuestionRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mode,
    tuningId,
    minFret,
    maxFret,
    noteSet,
    scaleRoot,
    scaleId,
    scaleDirection,
    scaleOctaves,
    chordRoot,
    chordTypeId,
    progressionId,
    instrument,
    customTuning,
  ])

  function handleChordPitch(result: PitchResult) {
    const chord = chordQuestionRef.current
    if (!chord || result.midi === null || result.confidence < 0.72) {
      if (result.midi === null) {
        stableMidiRef.current = null
        stableCountRef.current = 0
      }
      return
    }

    if (stableMidiRef.current === result.midi) {
      stableCountRef.current += 1
    } else {
      stableMidiRef.current = result.midi
      stableCountRef.current = 1
    }
    if (stableCountRef.current < 3) return

    const now = Date.now()
    if (now - lastJudgementRef.current < 220) return
    lastJudgementRef.current = now

    const pc = pitchClass(result.midi)
    if (!chord.tones.includes(pc)) {
      setFeedback(`再试一次 · ${midiToFullName(result.midi)} 不属于 ${chord.name}`)
      setFeedbackTone('wrong')
      setProgress((previous) => ({
        ...previous,
        attempts: previous.attempts + 1,
        wrong: previous.wrong + 1,
        streak: 0,
        updatedAt: Date.now(),
      }))
      return
    }
    if (chordCollectedRef.current.includes(pc)) return

    const collected = [...chordCollectedRef.current, pc]
    chordCollectedRef.current = collected
    setChordCollected(collected)
    const remaining = chord.tones.filter((tone) => !collected.includes(tone))
    const responseMs = now - questionStartedAt
    setProgress((previous) => {
      const streak = previous.streak + 1
      return {
        ...previous,
        attempts: previous.attempts + 1,
        correct: previous.correct + 1,
        streak,
        bestStreak: Math.max(previous.bestStreak, streak),
        totalResponseMs: previous.totalResponseMs + responseMs,
        updatedAt: Date.now(),
      }
    })

    if (remaining.length === 0) {
      setProgress((previous) => ({
        ...previous,
        completed: (previous.completed ?? 0) + 1,
        updatedAt: Date.now(),
      }))
      setFeedbackTone('correct')
      setFeedback(`${chord.name} 完成 · 共 ${chord.tones.length} 个和弦音`)
      window.setTimeout(() => nextChordRef.current(), 900)
      return
    }

    setFeedbackTone('correct')
    setFeedback(`${midiToNoteName(pc)} 已识别 · 还差 ${remaining.length} 个和弦音`)
  }

  function handleDetectedPitch(result: PitchResult) {
    if (mode === 'chord') {
      handleChordPitch(result)
      return
    }
    const current = questionRef.current
    if (!current || answeredRef.current || result.midi === null || result.confidence < 0.72) {
      if (result.midi === null) {
        stableMidiRef.current = null
        stableCountRef.current = 0
      }
      return
    }

    if (stableMidiRef.current === result.midi) {
      stableCountRef.current += 1
    } else {
      stableMidiRef.current = result.midi
      stableCountRef.current = 1
    }
    if (stableCountRef.current < 3) return

    const now = Date.now()
    if (now - lastJudgementRef.current < 850) return
    lastJudgementRef.current = now

    if (noteMatches(result.midi, current.targetMidi, exactOctave)) {
      answeredRef.current = true
      const responseMs = now - questionStartedAt
      setRevealed(true)
      const correctMessage = `正确 · ${midiToFullName(result.midi)}${result.cents >= 0 ? '+' : ''}${result.cents.toFixed(0)} cents`
      setProgress((previous) => {
        const streak = previous.streak + 1
        return {
          ...previous,
          attempts: previous.attempts + 1,
          correct: previous.correct + 1,
          streak,
          bestStreak: Math.max(previous.bestStreak, streak),
          totalResponseMs: previous.totalResponseMs + responseMs,
          updatedAt: Date.now(),
        }
      })
      if (current.mode === 'scale') {
        const sequence = scaleSequenceRef.current
        const isLast = scaleIndexRef.current >= sequence.length - 1
        if (isLast) {
          setProgress((previous) => ({
            ...previous,
            completed: (previous.completed ?? 0) + 1,
            updatedAt: Date.now(),
          }))
          setFeedback(`音阶完成 · ${correctMessage}`)
          setFeedbackTone('correct')
          window.setTimeout(() => {
            scaleIndexRef.current = 0
            setScaleIndex(0)
            const first = sequence[0]
            setQuestionState(
              first ? { mode: 'scale', scaleName: scaleTitle(), ...first } : null,
              '音阶完成，开始下一轮',
            )
            setFeedbackTone('correct')
          }, 900)
        } else {
          const nextIndex = scaleIndexRef.current + 1
          scaleIndexRef.current = nextIndex
          setScaleIndex(nextIndex)
          const nextStep = sequence[nextIndex]
          setQuestionState(
            nextStep ? { mode: 'scale', scaleName: scaleTitle(), ...nextStep } : null,
            `${correctMessage} · 下一个 ${midiToFullName(nextStep.targetMidi)}`,
          )
          setFeedbackTone('correct')
        }
      } else {
        setFeedback(correctMessage)
        setFeedbackTone('correct')
        window.setTimeout(() => nextQuestionRef.current(), 800)
      }
    } else {
      setFeedback(
        `再试一次 · 你弹了 ${midiToFullName(result.midi)}，目标${exactOctave ? '' : '音名'}是 ${midiToFullName(current.targetMidi)}`,
      )
      setFeedbackTone('wrong')
      setProgress((previous) => ({
        ...previous,
        attempts: previous.attempts + 1,
        wrong: previous.wrong + 1,
        streak: 0,
        updatedAt: Date.now(),
      }))
    }
  }

  const handleDetectedPitchRef = useRef(handleDetectedPitch)
  handleDetectedPitchRef.current = handleDetectedPitch

  async function startMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setFeedback('当前浏览器不支持麦克风输入')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })
      const context = new AudioContext({ latencyHint: 'interactive' })
      await context.resume()
      const source = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 4096
      analyser.smoothingTimeConstant = 0
      source.connect(analyser)

      streamRef.current = stream
      audioContextRef.current = context
      analyserRef.current = analyser
      samplesRef.current = new Float32Array(analyser.fftSize)
      setMicOn(true)
      setFeedback('麦克风已启用，等待稳定音高')

      const tick = () => {
        const currentAnalyser = analyserRef.current
        const samples = samplesRef.current
        const currentContext = audioContextRef.current
        if (!currentAnalyser || !samples || !currentContext) return
        currentAnalyser.getFloatTimeDomainData(samples)
        const pitchRange = INSTRUMENT_PITCH_RANGES[instrumentRef.current]
        const found = detectPitchYin(
          samples,
          currentContext.sampleRate,
          pitchRange.minHz,
          pitchRange.maxHz,
        )
        handleDetectedPitchRef.current(found)
        const now = performance.now()
        if (now - lastUiUpdateRef.current > 60) {
          lastUiUpdateRef.current = now
          setPitch(found)
        }
        animationRef.current = requestAnimationFrame(tick)
      }
      tick()
    } catch (caught) {
      setFeedback(caught instanceof Error ? `麦克风启动失败：${caught.message}` : '麦克风启动失败')
    }
  }

  function stopMicrophone() {
    cancelAnimationFrame(animationRef.current)
    streamRef.current?.getTracks().forEach((track) => track.stop())
    void audioContextRef.current?.close()
    streamRef.current = null
    audioContextRef.current = null
    analyserRef.current = null
    samplesRef.current = null
    setMicOn(false)
    setPitch(null)
  }

  useEffect(
    () => () => {
      cancelAnimationFrame(animationRef.current)
      streamRef.current?.getTracks().forEach((track) => track.stop())
      void audioContextRef.current?.close()
      audioContextRef.current = null
      analyserRef.current = null
      samplesRef.current = null
    },
    [],
  )

  const accuracy =
    progress.attempts > 0 ? Math.round((progress.correct / progress.attempts) * 100) : 0
  const averageResponse =
    progress.correct > 0 ? Math.round(progress.totalResponseMs / progress.correct) : 0
  const detectedPositions =
    pitch?.midi !== null && pitch?.midi !== undefined
      ? findFretPositions(pitch.midi, tuning, maxFret).filter(
          (position) => position.fret >= minFret && position.fret <= maxFret,
        )
      : []
  const targetPositions = question
    ? [{ stringIndex: question.stringIndex, fret: question.fret }]
    : []
  const chordTargets =
    mode === 'chord' && chordQuestion
      ? chordQuestion.shape.map((note) => ({
          stringIndex: note.stringIndex,
          fret: note.fret,
          done: chordCollected.includes(note.pitchClass),
        }))
      : []
  const fretTargets: FretTarget[] = mode === 'chord' ? chordTargets : targetPositions
  const fretTargetsVisible = mode === 'chord' ? chordTargets.length > 0 : revealed
  const chordShapeText =
    mode === 'chord' && chordQuestion
      ? chordQuestion.shape
          .map((note) => `${tuning.length - note.stringIndex} 弦 ${note.fret} 品`)
          .join(' · ')
      : ''
  const activeProgression =
    CHORD_PROGRESSIONS.find((item) => item.id === progressionId) ?? CHORD_PROGRESSIONS[0]
  const progressionUsesOwnTypes = activeProgression.steps.some((step) => step.typeId)

  return (
    <div className="module fretboard-module">
      <section className="panel fr-settings-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Fretboard practice</p>
            <h2>指板练习</h2>
            <p className="muted">
              麦克风实时识别单音，按当前乐器弦序练习音位、音阶与和弦。
            </p>
          </div>
          <button
            className={`button ${micOn ? 'danger' : 'primary'}`}
            type="button"
            onClick={() => (micOn ? stopMicrophone() : void startMicrophone())}
          >
            {micOn ? '关闭麦克风' : '启用麦克风'}
          </button>
        </div>

        <div className="segmented instrument-switch" aria-label="选择乐器">
          <button
            type="button"
            className={instrument === 'guitar' ? 'active' : ''}
            onClick={() => setInstrument('guitar')}
          >
            吉他
          </button>
          <button
            type="button"
            className={instrument === 'bass' ? 'active' : ''}
            onClick={() => setInstrument('bass')}
          >
            贝斯
          </button>
        </div>

        <div className="segmented">
          <button
            type="button"
            className={mode === 'note' ? 'active' : ''}
            onClick={() => setMode('note')}
          >
            音位识别
          </button>
          <button
            type="button"
            className={mode === 'scale' ? 'active' : ''}
            onClick={() => setMode('scale')}
          >
            音阶练习
          </button>
          <button
            type="button"
            className={mode === 'chord' ? 'active' : ''}
            onClick={() => setMode('chord')}
          >
            和弦练习
          </button>
        </div>

        <div className="control-grid">
          <label>
            <span>调弦</span>
            <select value={tuningId} onChange={(event) => setTuningId(event.target.value)}>
              {presets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
              <option value="custom">自定义</option>
            </select>
          </label>
          <label>
            <span>把位 / 品数</span>
            <select
              value={fretRangeId}
              onChange={(event) => {
                const next = FRET_RANGES.find((range) => range.id === event.target.value)
                if (!next) return
                setFretRangeId(next.id)
                setMinFret(next.min)
                setMaxFret(next.max)
              }}
            >
              {FRET_RANGES.map((range) => (
                <option key={range.id} value={range.id}>
                  {range.label}
                </option>
              ))}
            </select>
          </label>
          {mode === 'note' && (
            <label>
              <span>音集</span>
              <select
                value={noteSet}
                onChange={(event) => setNoteSet(event.target.value as NoteSet)}
              >
                <option value="all">全部音</option>
                <option value="natural">自然音</option>
                <option value="accidental">升降音</option>
              </select>
            </label>
          )}
          {mode === 'scale' && (
            <>
              <label>
                <span>调式</span>
                <select
                  value={scaleId}
                  onChange={(event) => setScaleId(event.target.value)}
                >
                  {SCALES.map((scale) => (
                    <option key={scale.id} value={scale.id}>
                      {scale.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>主音</span>
                <select
                  value={scaleRoot}
                  onChange={(event) => setScaleRoot(Number(event.target.value))}
                >
                  {Array.from({ length: 12 }, (_, index) => (
                    <option key={index} value={index}>
                      {midiToNoteName(index)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>方向</span>
                <select
                  value={scaleDirection}
                  onChange={(event) =>
                    setScaleDirection(event.target.value as ScaleDirection)
                  }
                >
                  <option value="up">上行</option>
                  <option value="down">下行</option>
                  <option value="updown">上下行</option>
                </select>
              </label>
              <label>
                <span>八度范围</span>
                <select
                  value={scaleOctaves}
                  onChange={(event) => setScaleOctaves(Number(event.target.value))}
                >
                  <option value={1}>1 个八度</option>
                  <option value={2}>2 个八度</option>
                </select>
              </label>
            </>
          )}
          {mode === 'chord' && (
            <>
              <label>
                <span>根音</span>
                <select
                  value={chordRoot}
                  onChange={(event) => setChordRoot(Number(event.target.value))}
                >
                  {Array.from({ length: 12 }, (_, index) => (
                    <option key={index} value={index}>
                      {midiToNoteName(index)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>和弦类型</span>
                <select
                  value={progressionUsesOwnTypes ? 'auto' : chordTypeId}
                  disabled={progressionUsesOwnTypes}
                  onChange={(event) => setChordTypeId(event.target.value)}
                >
                  {progressionUsesOwnTypes && <option value="auto">按进行自动（7th 等）</option>}
                  {CHORD_TYPES.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>和弦进行</span>
                <select
                  value={progressionId}
                  onChange={(event) => setProgressionId(event.target.value)}
                >
                  {CHORD_PROGRESSIONS.map((progression) => (
                    <option key={progression.id} value={progression.id}>
                      {progression.name}
                    </option>
                  ))}
                </select>
                {activeProgression.hint && (
                  <small className="field-hint">{activeProgression.hint}</small>
                )}
              </label>
            </>
          )}
          {mode !== 'chord' && (
            <label className="checkbox wide">
              <input
                type="checkbox"
                checked={exactOctave}
                onChange={(event) => setExactOctave(event.target.checked)}
              />
              必须弹对八度，而不只是音名
            </label>
          )}
        </div>

        {tuningId === 'custom' && (
          <label className="custom-tuning">
            <span>自定义调弦（低到高）</span>
            <input
              value={customTuning}
              onChange={(event) => setCustomTuning(event.target.value)}
              placeholder={instrument === 'bass' ? 'E1 A1 D2 G2' : 'E2 A2 D3 G3 B3 E4'}
            />
            {!customParsed && (
              <small>
                请输入 4–6 个音名，例如{' '}
                {instrument === 'bass' ? 'E1 A1 D2 G2' : 'E2 A2 D3 G3 B3 E4'}
              </small>
            )}
          </label>
        )}
      </section>

      <section className="panel practice-panel">
        <div
          className="question-card"
          key={mode === 'chord' ? `chord-${chordVersion}` : questionVersion}
        >
          <p className="eyebrow">
            {mode === 'chord'
              ? '和弦练习'
              : question?.mode === 'scale'
                ? question.scaleName
                : '音位识别'}
          </p>
          <h2>
            {mode === 'chord'
              ? chordQuestion
                ? (
                    <>
                      <span className="target-note-name">{chordQuestion.name}</span>
                      <span className="target-position">
                        第 {chordQuestion.index + 1} / {chordQuestion.total} 个 ·{' '}
                        {chordQuestion.progressionName}
                      </span>
                    </>
                  )
                : '准备中…'
              : question
                ? question.mode === 'note'
                  ? (
                      <>
                        <span className="target-note-name">
                          {midiToFullName(question.targetMidi)}
                        </span>
                        <span className="target-position">
                          在 {tuning.length - question.stringIndex} 弦 {question.fret} 品
                        </span>
                      </>
                    )
                  : `弹奏 ${midiToFullName(question.targetMidi)}`
                : '准备中…'}
          </h2>
          <p className={`feedback ${feedbackTone}`}>{feedback}</p>
          {mode !== 'chord' && question && (
            <p className="muted">
              目标音：{midiToFullName(question.targetMidi)}
              {question.mode === 'note'
                ? ` · ${tuning.length - question.stringIndex} 弦 ${question.fret} 品`
                : ''}
              {question.mode === 'scale'
                ? ` · 进度 ${Math.min(scaleIndex + 1, scaleSequence.length)} / ${scaleSequence.length}`
                : ''}
            </p>
          )}
          <div className="pitch-readout">
            <div>
              <strong className="pitch-note-value" key={pitch?.note ?? 'none'}>
                {pitch?.note ?? '—'}
              </strong>
              <span>识别音高</span>
            </div>
            <div>
              <strong>{pitch?.frequency ? `${pitch.frequency.toFixed(1)} Hz` : '—'}</strong>
              <span>频率</span>
            </div>
            <div>
              <strong>{pitch?.confidence ? `${Math.round(pitch.confidence * 100)}%` : '—'}</strong>
              <span>置信度</span>
            </div>
            <div>
              <strong>
                {pitch?.rms ? `${rmsToDb(pitch.rms).toFixed(1)} dB` : '—'}
              </strong>
              <span>输入电平</span>
            </div>
          </div>
        </div>

        {question?.mode === 'scale' && scaleSequence.length > 0 && (
          <div className="scale-sequence" aria-label="音阶练习进度">
            {scaleSequence.map((step, index) => (
              <span
                key={`${step.targetMidi}-${index}`}
                ref={index === scaleIndex ? currentScaleChipRef : undefined}
                className={
                  index < scaleIndex ? 'done' : index === scaleIndex ? 'current' : ''
                }
              >
                <strong>{midiToFullName(step.targetMidi)}</strong>
                <small>
                  {tuning.length - step.stringIndex} 弦 {step.fret} 品
                </small>
              </span>
            ))}
          </div>
        )}

        {mode === 'chord' && chordQuestion && (
          <div className="chord-tones" aria-label="和弦音进度">
            {chordQuestion.tones.map((pc) => {
              const done = chordCollected.includes(pc)
              return (
                <span key={pc} className={done ? 'done' : ''}>
                  <strong>{midiToNoteName(pc)}</strong>
                  <small>{pc === chordQuestion.rootPc ? '根音' : '和弦音'}</small>
                </span>
              )
            })}
            {chordShapeText && <em className="chord-shape-hint">建议指法：{chordShapeText}</em>}
          </div>
        )}

        <div className="fretboard-scroll">
          <FretboardSvg
            tuning={tuning}
            maxFret={maxFret}
            targets={fretTargets}
            targetsVisible={fretTargetsVisible}
            detected={detectedPositions}
          />
        </div>

        <div className="stat-row">
          <div>
            <strong>{accuracy}%</strong>
            <span>正确率</span>
          </div>
          <div>
            <strong>{progress.correct}</strong>
            <span>答对</span>
          </div>
          <div>
            <strong>{progress.wrong}</strong>
            <span>答错</span>
          </div>
          <div>
            <strong>{progress.streak}</strong>
            <span>当前连击</span>
          </div>
          <div>
            <strong>{averageResponse ? `${(averageResponse / 1000).toFixed(1)}s` : '—'}</strong>
            <span>平均反应</span>
          </div>
          {mode !== 'note' && (
            <div>
              <strong>{progress.completed ?? 0}</strong>
              <span>{mode === 'chord' ? '完成和弦' : '完成轮次'}</span>
            </div>
          )}
          <button className="button" type="button" onClick={nextQuestion}>
            {mode === 'scale' ? '跳到下一音' : mode === 'chord' ? '下一个和弦' : '下一题'}
          </button>
          {mode === 'chord' ? (
            <button className="button ghost" type="button" onClick={nextChord}>
              跳过本和弦
            </button>
          ) : (
            <button className="button ghost" type="button" onClick={() => setRevealed(true)}>
              显示答案
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
