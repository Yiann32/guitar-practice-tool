import * as alphaTab from '@coderline/alphatab'
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  createId,
  fileFormat,
  getSong,
  listSongs,
  patchSong,
  removeSong,
  saveSong,
} from '../../data/db'
import { formatClock, midiToFullName, clamp, pitchClass } from '../../lib/music'
import { withBase } from '../../lib/baseUrl'
import { detectInstrument } from '../../lib/instrument'
import { detectPitchYin } from '../../lib/pitch'
import type { PitchResult, SongRecord } from '../../types'
import InstrumentIcon from '../../components/InstrumentIcon'
import AudioToMidiPanel from './AudioToMidiPanel'
import PdfScoreViewer from './PdfScoreViewer'

const PAGE_BARS = 16
const BARS_PER_ROW = 4
const SCORE_HEIGHT_KEY = 'guitar-practice-score-height'
const SAMPLE_FILE = withBase('samples/smoke-on-the-water.gp5')
const SAMPLE_TITLE = 'Smoke On The Water'

function initialScoreHeight(): number {
  if (typeof window === 'undefined') return 460
  const stored = Number(localStorage.getItem(SCORE_HEIGHT_KEY))
  if (Number.isFinite(stored) && stored >= 300) return stored
  return Math.min(460, Math.max(320, window.innerHeight * 0.46))
}

function currentBarsPerRow(): number {
  if (typeof window === 'undefined') return BARS_PER_ROW
  if (window.innerWidth <= 520) return 1
  if (window.innerWidth <= 760) return 2
  if (window.innerWidth <= 1100) return 3
  return BARS_PER_ROW
}

interface PendingImport {
  id: string
  fileName: string
  format: string
  size: number
  existing?: SongRecord
  record?: SongRecord
  sample?: boolean
}

interface RestoreState {
  lastTick: number
  playbackSpeed: number
  loopStart: number | null
  loopEnd: number | null
  selectedTrackIndexes: number[]
}

interface ActivePdf {
  id: string
  title: string
  data: ArrayBuffer
  lastPage: number
}

type DisplayMode = 'tab' | 'scoreTab' | 'score'
type PracticeMode = 'play' | 'follow' | 'accompany'

interface PracticeEvent {
  tick: number
  midis: number[]
  names: string[]
  /** 闷音（谱面记作 x 的无音高音符）所在的拍子，不参与判定与评分。 */
  muted: boolean
  notes: alphaTab.model.Note[]
  beat: alphaTab.model.Beat
}

interface PracticeSummary {
  pitch: number
  rhythm: number
  overall: number
  hits: number
  total: number
  averageMs: number
}

const TIMING_WINDOW_TICKS = 480

const BASS_TRACK_PATTERN = /bass|ベース|贝斯/i
const GUITAR_TRACK_PATTERN = /guitar|gtr|ギター|吉他/i
const VOCAL_TRACK_PATTERN = /vocal|voice|vox|sing|人声|唱/i

/**
 * 多音轨曲谱的默认选中轨：优先吉他/贝斯六线谱，尽量避开人声轨和打击乐轨。
 */
function pickDefaultTrackIndex(tracks: alphaTab.model.Track[]): number {
  let bestIndex = 0
  let bestScore = Number.NEGATIVE_INFINITY
  tracks.forEach((track, index) => {
    if (track.isPercussion) return
    if (!track.staves.some((staff) => staff.showTablature)) return
    let score = 1
    if (BASS_TRACK_PATTERN.test(track.name)) score += 2
    else if (GUITAR_TRACK_PATTERN.test(track.name)) score += 3
    if (VOCAL_TRACK_PATTERN.test(track.name)) score -= 6
    if (score > bestScore) {
      bestScore = score
      bestIndex = index
    }
  })
  return bestIndex
}

function findMasterBarIndex(score: alphaTab.model.Score, tick: number): number {
  let result = 0
  for (let index = 0; index < score.masterBars.length; index += 1) {
    if (score.masterBars[index].start <= tick) result = index
    else break
  }
  return result
}

export default function ScoreModule() {
  const renderTargetRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingImportRef = useRef<PendingImport | null>(null)
  const restoreRef = useRef<RestoreState | null>(null)
  const activeSongIdRef = useRef<string | null>(null)
  const playingRef = useRef(false)
  const pageRef = useRef(0)
  const pageCountRef = useRef(1)
  const pageTurnLockRef = useRef(false)
  const initialTrackAppliedRef = useRef(false)
  const originalTracksRef = useRef<alphaTab.model.Track[] | null>(null)
  const originalStaffDisplayRef = useRef<
    Array<Array<{ tab: boolean; score: boolean }>>
  >([])
  const micStreamRef = useRef<MediaStream | null>(null)
  const micContextRef = useRef<AudioContext | null>(null)
  const micAnalyserRef = useRef<AnalyserNode | null>(null)
  const micSamplesRef = useRef<Float32Array<ArrayBuffer> | null>(null)
  const micAnimationRef = useRef(0)
  const micStableMidiRef = useRef<number | null>(null)
  const micStableCountRef = useRef(0)
  const lastMicJudgementRef = useRef(0)
  const practiceEventsRef = useRef<PracticeEvent[]>([])
  const followIndexRef = useRef(0)
  const accompanyMatchedRef = useRef<Set<number>>(new Set())
  const accompanyMissedRef = useRef<Set<number>>(new Set())
  const accompanyTimingRef = useRef(0)
  const practiceModeRef = useRef<PracticeMode>('play')
  const displayModeRef = useRef<DisplayMode>('tab')
  const preferredDisplayModeRef = useRef<DisplayMode>('tab')
  const activeTrackIndexRef = useRef<number | null>(null)

  const [songs, setSongs] = useState<SongRecord[]>([])
  const [activeSongId, setActiveSongId] = useState<string | null>(null)
  const [activePdf, setActivePdf] = useState<ActivePdf | null>(null)
  const [libraryCollapsed, setLibraryCollapsed] = useState(false)
  const [score, setScore] = useState<alphaTab.model.Score | null>(null)
  const [tracks, setTracks] = useState<alphaTab.model.Track[]>([])
  const [activeTrackIndex, setActiveTrackIndex] = useState<number | null>(null)
  const [mutedTrackIndexes, setMutedTrackIndexes] = useState<Set<number>>(new Set())
  const [soloTrackIndexes, setSoloTrackIndexes] = useState<Set<number>>(new Set())
  const [displayMode, setDisplayMode] = useState<DisplayMode>('tab')
  const [practiceMode, setPracticeMode] = useState<PracticeMode>('play')
  const [micOn, setMicOn] = useState(false)
  const [detectedNote, setDetectedNote] = useState('')
  const [followTarget, setFollowTarget] = useState<PracticeEvent | null>(null)
  const [followSkipped, setFollowSkipped] = useState(0)
  const [practiceSummary, setPracticeSummary] = useState<PracticeSummary | null>(null)
  const [audioToolOpen, setAudioToolOpen] = useState(false)
  const [pageTurn, setPageTurn] = useState<'idle' | 'next' | 'prev'>('idle')
  const [sheetProgress, setSheetProgress] = useState(0)
  const [scoreHeight, setScoreHeight] = useState(initialScoreHeight)
  const scoreHeightRef = useRef(scoreHeight)
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const [liveScore, setLiveScore] = useState<PracticeSummary>({
    pitch: 0,
    rhythm: 0,
    overall: 0,
    hits: 0,
    total: 0,
    averageMs: 0,
  })
  const [playing, setPlaying] = useState(false)
  const [playerReady, setPlayerReady] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [metronomeVolume, setMetronomeVolume] = useState(0.5)
  const [countInVolume, setCountInVolume] = useState(0)
  const [loopA, setLoopA] = useState<number | null>(null)
  const [loopB, setLoopB] = useState<number | null>(null)
  const [looping, setLooping] = useState(false)
  const [pageIndex, setPageIndex] = useState(0)
  const [pageCount, setPageCount] = useState(1)
  const [activeNotes, setActiveNotes] = useState<string[]>([])
  const [position, setPosition] = useState({
    currentTick: 0,
    endTick: 1,
    currentTime: 0,
    endTime: 0,
  })
  const [error, setError] = useState('')

  async function refreshSongs() {
    setSongs(await listSongs())
  }

  useEffect(() => {
    void refreshSongs()
    if (window.innerWidth < 760) setLibraryCollapsed(true)
  }, [])

  useEffect(() => {
    if (!renderTargetRef.current) return

    const api = new alphaTab.AlphaTabApi(renderTargetRef.current, {
      core: {
        engine: 'svg',
        enableLazyLoading: true,
        fontDirectory: withBase('font/'),
      },
      display: {
        scale: 0.92,
        staveProfile: alphaTab.StaveProfile.Tab,
        layoutMode: alphaTab.LayoutMode.Page,
        barsPerRow: currentBarsPerRow(),
        startBar: 1,
        barCount: -1,
        systemsLayoutMode: alphaTab.SystemsLayoutMode.Automatic,
      },
      notation: {
        rhythmMode: alphaTab.TabRhythmMode.ShowWithBars,
      },
      player: {
        playerMode: alphaTab.PlayerMode.EnabledSynthesizer,
        soundFont: withBase('soundfont/sonivox.sf2'),
        scrollElement: document.body,
        scrollMode: alphaTab.ScrollMode.Off,
        enableCursor: true,
        enableAnimatedBeatCursor: true,
        enableElementHighlighting: true,
        enableUserInteraction: true,
        outputMode: alphaTab.PlayerOutputMode.WebAudioAudioWorklets,
      },
    })

    apiRef.current = api
    api.settings.notation.elements.set(alphaTab.NotationElement.ChordDiagrams, false)
    const tablatureFont = api.settings.display.resources.tablatureFont
    tablatureFont.size *= 0.72

    api.scoreLoaded.on((loadedScore) => {
      loadedScore.stylesheet.multiTrackMultiBarRest = false
      loadedScore.stylesheet.perTrackMultiBarRest = null
      const totalPages = Math.max(1, Math.ceil(loadedScore.masterBars.length / PAGE_BARS))
      originalTracksRef.current = [...loadedScore.tracks]
      originalStaffDisplayRef.current = loadedScore.tracks.map((track) =>
        track.staves.map((staff) => ({
          tab: staff.showTablature,
          score: staff.showStandardNotation,
        })),
      )
      initialTrackAppliedRef.current = false
      pageCountRef.current = totalPages
      setScore(loadedScore)
      setTracks([...loadedScore.tracks])
      setActiveTrackIndex(null)
      setPageCount(totalPages)
      setError('')

      const pending = pendingImportRef.current
      pendingImportRef.current = null
      if (pending?.record) {
        const title =
          pending.record.title ||
          loadedScore.title ||
          pending.fileName.replace(/\.[^.]+$/, '')
        const nextRecord = { ...pending.record, title, updatedAt: Date.now() }
        void saveSong(nextRecord).then(refreshSongs)
        activeSongIdRef.current = nextRecord.id
        setActiveSongId(nextRecord.id)
      } else if (pending?.existing) {
        const title =
          pending.existing.title ||
          loadedScore.title ||
          pending.fileName.replace(/\.[^.]+$/, '')
        void patchSong(pending.existing.id, { title }).then(refreshSongs)
        activeSongIdRef.current = pending.existing.id
        setActiveSongId(pending.existing.id)
      }

      window.setTimeout(applyRestoreState, 0)
    })

    api.playerReady.on(() => {
      setPlayerReady(true)
      applyRestoreState()
    })

    api.playerStateChanged.on((args) => {
      const isPlaying = args.state === alphaTab.synth.PlayerState.Playing
      setPlaying(isPlaying)
      playingRef.current = isPlaying
      if (!isPlaying) {
        setActiveNotes([])
        if (
          practiceModeRef.current === 'accompany' &&
          accompanyMatchedRef.current.size + accompanyMissedRef.current.size > 0
        ) {
          setPracticeSummary(practiceSummaryFromState())
        }
      }
    })

    api.playerPositionChanged.on((args) => {
      setPosition({
        currentTick: args.currentTick,
        endTick: Math.max(1, args.endTick),
        currentTime: args.currentTime,
        endTime: args.endTime,
      })

      const loadedScore = api.score
      if (practiceModeRef.current === 'accompany' && playingRef.current && loadedScore) {
        let changed = false
        const events = practiceEventsRef.current
        for (let index = 0; index < events.length; index += 1) {
          if (
            !events[index].muted &&
            events[index].tick + TIMING_WINDOW_TICKS < args.currentTick &&
            !accompanyMatchedRef.current.has(index) &&
            !accompanyMissedRef.current.has(index)
          ) {
            accompanyMissedRef.current.add(index)
            changed = true
          }
        }
        if (changed) updateLiveScore()
      }
      if (!playingRef.current || !loadedScore || loadedScore.masterBars.length === 0) return
      const barIndex = findMasterBarIndex(loadedScore, args.currentTick)
      const targetPage = Math.floor(barIndex / PAGE_BARS)
      if (targetPage !== pageRef.current && targetPage < pageCountRef.current) {
        applyPage(targetPage, true)
      }
    })

    api.activeBeatsChanged.on((args) => {
      const names = new Set<string>()
      for (const beat of args.activeBeats) {
        for (const note of beat.notes) {
          if (!note.isPercussion) names.add(midiToFullName(note.realValue))
        }
      }
      setActiveNotes([...names])
    })

    api.error.on((caught) => {
      const pending = pendingImportRef.current
      pendingImportRef.current = null
      const message = caught.message || 'alphaTab 渲染或播放失败。'
      if (/reading 'staves'/.test(message)) {
        // alphaTab 1.8 在部分 GP8 多小节休止谱面上会抛出该内部错误，
        // 但布局会继续完成渲染。这里静默处理，避免把内部异常暴露给用户。
        setError('')
        return
      }
      if (pending && /importer|unsupported format|score\.gpif|zip archive/i.test(message)) {
        setError(
          `无法导入「${pending.fileName}」：文件可能已加密、被锁定或不是标准 Guitar Pro 格式。请用 Guitar Pro 重新导出为 GPX/GP5/MusicXML 后再试。`,
        )
        activeSongIdRef.current = null
        setActiveSongId(null)
        return
      }
      setError(message)
    })

    void loadSampleScore()

    return () => {
      api.destroy()
      apiRef.current = null
    }
  }, [])

  function applyPage(targetPage: number, preservePosition: boolean) {
    const api = apiRef.current
    const loadedScore = api?.score
    if (!api || !loadedScore || pageTurnLockRef.current) return
    const totalPages = Math.max(1, Math.ceil(loadedScore.masterBars.length / PAGE_BARS))
    const page = clamp(targetPage, 0, totalPages - 1)
    const direction = page > pageRef.current ? 'next' : page < pageRef.current ? 'prev' : 'idle'
    pageTurnLockRef.current = true
    pageRef.current = page
    setPageIndex(page)
    if (direction !== 'idle') {
      setPageTurn(direction)
      window.setTimeout(() => setPageTurn('idle'), 460)
    }
    const scroller = scrollRef.current
    if (scroller) {
      const barIndex = Math.min(loadedScore.masterBars.length - 1, page * PAGE_BARS)
      const bounds = api.boundsLookup?.findMasterBarByIndex(barIndex)
      const fallbackTop = (scroller.scrollHeight * page) / totalPages
      scroller.scrollTo({
        top: bounds ? Math.max(0, bounds.realBounds.y - 8) : fallbackTop,
        behavior: preservePosition ? 'smooth' : 'auto',
      })
    }
    window.setTimeout(() => {
      pageTurnLockRef.current = false
    }, 220)
  }

  function locateCurrentProgress() {
    const api = apiRef.current
    if (!api?.score) return
    const barIndex = findMasterBarIndex(api.score, api.tickPosition)
    applyPage(Math.floor(barIndex / PAGE_BARS), true)
  }

  function clampScoreHeight(value: number): number {
    const max = Math.max(380, window.innerHeight * 0.86)
    return Math.min(max, Math.max(300, value))
  }

  function handleResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    resizeRef.current = { startY: event.clientY, startHeight: scoreHeight }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleResizePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!resizeRef.current) return
    const next = clampScoreHeight(
      resizeRef.current.startHeight + event.clientY - resizeRef.current.startY,
    )
    scoreHeightRef.current = next
    setScoreHeight(next)
  }

  function handleResizePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!resizeRef.current) return
    resizeRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    localStorage.setItem(SCORE_HEIGHT_KEY, String(scoreHeightRef.current))
  }

  function handleResizeKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const delta = event.key === 'ArrowDown' ? 24 : -24
    const next = clampScoreHeight(scoreHeightRef.current + delta)
    scoreHeightRef.current = next
    setScoreHeight(next)
    localStorage.setItem(SCORE_HEIGHT_KEY, String(next))
  }

  function renderSelection(
    index: number | null,
    mode: DisplayMode,
    explicitTrack?: alphaTab.model.Track | null,
  ) {
    const api = apiRef.current
    if (!api?.score) return
    const availableTracks = originalTracksRef.current ?? api.score.tracks
    const track =
      explicitTrack === undefined
        ? index === null
          ? null
          : availableTracks[index] ?? null
        : explicitTrack
    const hasTabAt = (trackIndex: number | null) => {
      const flags = originalStaffDisplayRef.current
      if (trackIndex === null) return flags.some((staffs) => staffs.some((staff) => staff.tab))
      return flags[trackIndex]?.some((staff) => staff.tab) ?? false
    }
    const hasScoreAt = (trackIndex: number | null) => {
      const flags = originalStaffDisplayRef.current
      if (trackIndex === null)
        return flags.some((staffs) => staffs.some((staff) => staff.score))
      return flags[trackIndex]?.some((staff) => staff.score) ?? false
    }
    const hasTab = hasTabAt(index)
    const hasScore = hasScoreAt(index)
    const effectiveMode: DisplayMode =
      mode === 'tab' && !hasTab
        ? 'score'
        : mode === 'score' && !hasScore
          ? hasTab
            ? 'tab'
            : mode
          : mode === 'scoreTab' && (!hasTab || !hasScore)
            ? hasTab
              ? 'tab'
              : 'score'
            : mode

    availableTracks.forEach((candidate, trackIndex) => {
      const reveal = index === null || trackIndex === index
      candidate.isVisibleOnMultiTrack = reveal
      candidate.staves.forEach((staff, staffIndex) => {
        const original = originalStaffDisplayRef.current[trackIndex]?.[staffIndex] ?? {
          tab: staff.showTablature,
          score: staff.showStandardNotation,
        }
        staff.showTablature = reveal && original.tab
        staff.showStandardNotation = reveal && original.score
      })
    })
    if (track) {
      track.staves.forEach((staff, staffIndex) => {
        const original = originalStaffDisplayRef.current[index!]?.[staffIndex] ?? {
          tab: staff.showTablature,
          score: staff.showStandardNotation,
        }
        const wantTab = effectiveMode !== 'score' && original.tab
        const wantScore =
          (effectiveMode !== 'tab' || !original.tab) && original.score
        staff.showTablature = wantTab
        staff.showStandardNotation = wantScore || (!wantTab && !wantScore)
      })
    }
    api.score.tracks = track ? [track] : [...availableTracks]
    api.settings.display.staveProfile = alphaTab.StaveProfile.Default
    api.settings.display.systemsLayoutMode = alphaTab.SystemsLayoutMode.Automatic
    api.settings.display.barsPerRow = currentBarsPerRow()
    api.updateSettings()
    setDisplayMode(effectiveMode)
    api.renderScore(api.score, undefined)
    api.loadMidiForScore()
    applyMixState()
    window.setTimeout(() => {
      applyMixState()
      applyPage(pageRef.current, false)
      if (practiceModeRef.current === 'follow') {
        highlightPracticeEvent(practiceEventsRef.current[followIndexRef.current] ?? null)
      }
    }, 240)
    setActiveTrackIndex(index)
    activeTrackIndexRef.current = index

    const sourceTrack = track ?? availableTracks[pickDefaultTrackIndex(availableTracks)]
    if (sourceTrack) syncPracticeEvents(sourceTrack)
  }

  function applyMixState(
    muted: Set<number> = mutedTrackIndexes,
    solo: Set<number> = soloTrackIndexes,
  ) {
    const api = apiRef.current
    const tracks = originalTracksRef.current ?? api?.score?.tracks ?? []
    if (!api || tracks.length === 0) return
    tracks.forEach((track, index) => {
      api.changeTrackMute([track], muted.has(index))
      api.changeTrackSolo([track], solo.has(index))
    })
  }

  function applyDisplayMode(mode: DisplayMode, track?: alphaTab.model.Track | null) {
    preferredDisplayModeRef.current = mode
    renderSelection(activeTrackIndexRef.current, mode, track)
  }

  function selectTrack(index: number | null) {
    const api = apiRef.current
    if (!api?.score) return
    if (index === null) {
      setSoloTrackIndexes(new Set())
      setMutedTrackIndexes(new Set())
    } else {
      setMutedTrackIndexes((previous) => {
        const next = new Set(previous)
        next.delete(index)
        return next
      })
    }
    renderSelection(index, preferredDisplayModeRef.current)
  }

  function buildPracticeEvents(track: alphaTab.model.Track): PracticeEvent[] {
    const byTick = new Map<number, Map<number, alphaTab.model.Note>>()
    const beatByTick = new Map<number, alphaTab.model.Beat>()
    const mutedTicks = new Set<number>()
    for (const staff of track.staves) {
      for (const bar of staff.bars) {
        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            const tick = beat.absolutePlaybackStart
            for (const note of beat.notes) {
              if (note.isPercussion || note.isTieDestination) continue
              beatByTick.set(tick, beat)
              // 闷音（x）没有可判定音高：只做标记，不进入跟练/陪练判定。
              if (note.isDead) {
                mutedTicks.add(tick)
                continue
              }
              const notes = byTick.get(tick) ?? new Map<number, alphaTab.model.Note>()
              notes.set(Math.round(note.realValue), note)
              byTick.set(tick, notes)
            }
          }
        }
      }
    }
    return [...new Set<number>([...byTick.keys(), ...mutedTicks])]
      .sort((a, b) => a - b)
      .map((tick) => {
        const noteMap = byTick.get(tick)
        const sorted = noteMap ? [...noteMap.keys()].sort((a, b) => a - b) : []
        return {
          tick,
          midis: sorted,
          names: [...new Set(sorted.map((midi) => midiToFullName(midi)))],
          muted: sorted.length === 0,
          notes: sorted.map((midi) => noteMap!.get(midi)!),
          beat: beatByTick.get(tick)!,
        }
      })
      .sort((a, b) => a.tick - b.tick)
  }

  function playableEvents(): PracticeEvent[] {
    return practiceEventsRef.current.filter((event) => !event.muted)
  }

  /** 从指定下标开始，跳过闷音拍，返回下一个需要弹奏的事件下标。 */
  function nextPlayableIndex(from: number): number {
    const events = practiceEventsRef.current
    let index = Math.max(0, from)
    while (index < events.length && events[index].muted) index += 1
    return index
  }

  function syncFollowTarget(index: number, withPageTurn = true): number {
    const events = practiceEventsRef.current
    const next = nextPlayableIndex(index)
    followIndexRef.current = next
    const target = events[next] ?? null
    setFollowTarget(target)
    setFollowSkipped(Math.max(0, next - index))
    const playable = playableEvents()
    const completed = target ? playable.indexOf(target) : playable.length
    setLiveScore({
      pitch: 100,
      rhythm: 100,
      overall: playable.length > 0 ? Math.round((completed / playable.length) * 100) : 0,
      hits: completed,
      total: playable.length,
      averageMs: 0,
    })
    highlightPracticeEvent(target)
    if (target && withPageTurn) {
      // 跟练不播放音频，playerPositionChanged 不会触发翻页，这里手动跟随目标音符翻页。
      const loadedScore = apiRef.current?.score
      if (loadedScore) {
        const barIndex = findMasterBarIndex(loadedScore, target.tick)
        const targetPage = Math.floor(barIndex / PAGE_BARS)
        if (targetPage !== pageRef.current && targetPage < pageCountRef.current) {
          applyPage(targetPage, true)
        }
      }
    }
    return next
  }

  function resetPracticeScore() {
    accompanyMatchedRef.current = new Set()
    accompanyMissedRef.current = new Set()
    accompanyTimingRef.current = 0
    followIndexRef.current = 0
    setLiveScore({ pitch: 0, rhythm: 0, overall: 0, hits: 0, total: 0, averageMs: 0 })
    setPracticeSummary(null)
  }

  function syncPracticeEvents(track: alphaTab.model.Track) {
    const events = buildPracticeEvents(track)
    practiceEventsRef.current = events
    resetPracticeScore()
    if (practiceModeRef.current === 'follow') {
      syncFollowTarget(0, false)
      return
    }
    const first = nextPlayableIndex(0)
    followIndexRef.current = first
    setFollowTarget(events[first] ?? null)
    setFollowSkipped(first)
  }

  function practiceSummaryFromState(): PracticeSummary {
    const total = playableEvents().length
    const hits = accompanyMatchedRef.current.size
    const misses = accompanyMissedRef.current.size
    const evaluated = Math.max(1, hits + misses)
    const pitch = hits / evaluated
    const rhythm =
      hits > 0
        ? Math.max(0, 1 - accompanyTimingRef.current / hits / TIMING_WINDOW_TICKS)
        : 0
    const tempo = apiRef.current?.score?.tempo || 100
    const msPerTick = 60000 / (tempo * 960)
    const averageMs = hits > 0 ? (accompanyTimingRef.current / hits) * msPerTick : 0
    const overall = total === 0 ? 0 : 0.65 * pitch + 0.35 * rhythm
    return {
      pitch: Math.round(pitch * 100),
      rhythm: Math.round(rhythm * 100),
      overall: Math.round(overall * 100),
      hits,
      total,
      averageMs,
    }
  }

  function updateLiveScore() {
    setLiveScore(practiceSummaryFromState())
  }

  function highlightPracticeEvent(event: PracticeEvent | null) {
    const api = apiRef.current
    if (!api) return
    if (!event) {
      api.clearPlaybackRangeHighlight()
      return
    }
    // alphaTab 的 highlightPlaybackRange 在 start === end 时只会清空高亮、
    // 不会绘制任何东西，所以这里用相邻的一拍构造范围，保证目标音符真的被框住。
    const beats = event.beat.voice.beats
    const next = beats[event.beat.index + 1]
    const previous = beats[event.beat.index - 1]
    const applyRange = () => {
      if (next) api.highlightPlaybackRange(event.beat, next)
      else if (previous) api.highlightPlaybackRange(previous, event.beat)
      else api.clearPlaybackRangeHighlight()
    }
    applyRange()
    api.tickPosition = event.tick
    window.setTimeout(applyRange, 30)
  }

  function handleScorePitch(result: PitchResult) {
    if (result.midi === null || result.confidence < 0.72) {
      if (result.midi === null) {
        micStableMidiRef.current = null
        micStableCountRef.current = 0
      }
      return
    }

    setDetectedNote(midiToFullName(result.midi))
    if (micStableMidiRef.current === result.midi) {
      micStableCountRef.current += 1
    } else {
      micStableMidiRef.current = result.midi
      micStableCountRef.current = 1
    }
    if (micStableCountRef.current < 3) return

    const now = Date.now()
    if (now - lastMicJudgementRef.current < 260) return
    lastMicJudgementRef.current = now
    const mode = practiceModeRef.current
    if (mode === 'play') return

    const events = practiceEventsRef.current
    if (mode === 'follow') {
      const target = events[followIndexRef.current]
      if (
        !target ||
        target.muted ||
        !target.midis.some((midi) => pitchClass(midi) === pitchClass(result.midi!))
      ) {
        return
      }
      const next = syncFollowTarget(followIndexRef.current + 1)
      if (next >= events.length) {
        apiRef.current?.clearPlaybackRangeHighlight()
      }
      return
    }

    if (mode === 'accompany') {
      const api = apiRef.current
      if (!api) return
      const currentTick = api.tickPosition
      let bestIndex = -1
      let bestDistance = Number.POSITIVE_INFINITY
      for (let index = 0; index < events.length; index += 1) {
        if (
          events[index].muted ||
          accompanyMatchedRef.current.has(index) ||
          accompanyMissedRef.current.has(index)
        ) {
          continue
        }
        const distance = Math.abs(events[index].tick - currentTick)
        if (distance <= TIMING_WINDOW_TICKS && distance < bestDistance) {
          bestIndex = index
          bestDistance = distance
        }
      }
      if (bestIndex < 0) return
      const expected = events[bestIndex]
      if (!expected.midis.some((midi) => pitchClass(midi) === pitchClass(result.midi!))) {
        return
      }
      accompanyMatchedRef.current.add(bestIndex)
      accompanyTimingRef.current += bestDistance
      updateLiveScore()
    }
  }

  const handleScorePitchRef = useRef(handleScorePitch)
  handleScorePitchRef.current = handleScorePitch

  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(
      window as unknown as {
        __simulateScorePitch?: (midi: number) => void
      }
    ).__simulateScorePitch = (midi: number) =>
      handleScorePitchRef.current({
        frequency: 440 * 2 ** ((midi - 69) / 12),
        midi,
        note: midiToFullName(midi),
        octave: Math.floor(midi / 12) - 1,
        cents: 0,
        confidence: 1,
        rms: 0.1,
      })
    ;(
      window as unknown as {
        __getTrackMixState?: () => Array<{ name: string; mute: boolean; solo: boolean }>
      }
    ).__getTrackMixState = () =>
      (originalTracksRef.current ?? []).map((track) => ({
        name: track.name,
        mute: track.playbackInfo.isMute,
        solo: track.playbackInfo.isSolo,
      }))
    return () => {
      delete (
        window as unknown as {
          __simulateScorePitch?: (midi: number) => void
        }
      ).__simulateScorePitch
      delete (
        window as unknown as {
          __getTrackMixState?: () => Array<{ name: string; mute: boolean; solo: boolean }>
        }
      ).__getTrackMixState
    }
  }, [])

  async function startScoreMicrophone() {
    if (micOn) return
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('当前浏览器不支持麦克风输入。')
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
      micStreamRef.current = stream
      micContextRef.current = context
      micAnalyserRef.current = analyser
      micSamplesRef.current = new Float32Array(analyser.fftSize)
      setMicOn(true)

      const tick = () => {
        const analyserNode = micAnalyserRef.current
        const samples = micSamplesRef.current
        const audioContext = micContextRef.current
        if (!analyserNode || !samples || !audioContext) return
        analyserNode.getFloatTimeDomainData(samples)
        handleScorePitchRef.current(detectPitchYin(samples, audioContext.sampleRate))
        micAnimationRef.current = requestAnimationFrame(tick)
      }
      tick()
    } catch (caught) {
      setError(caught instanceof Error ? `麦克风启动失败：${caught.message}` : '麦克风启动失败')
    }
  }

  function stopScoreMicrophone() {
    cancelAnimationFrame(micAnimationRef.current)
    micStreamRef.current?.getTracks().forEach((track) => track.stop())
    void micContextRef.current?.close()
    micStreamRef.current = null
    micContextRef.current = null
    micAnalyserRef.current = null
    micSamplesRef.current = null
    setMicOn(false)
    setDetectedNote('')
  }

  function changePracticeMode(mode: PracticeMode) {
    const api = apiRef.current
    practiceModeRef.current = mode
    setPracticeMode(mode)
    resetPracticeScore()
    if (mode === 'play') {
      stopScoreMicrophone()
      apiRef.current?.clearPlaybackRangeHighlight()
      return
    }
    void startScoreMicrophone()
    if (!api) return
    api.stop()
    api.clearPlaybackRangeHighlight()
    if (mode === 'follow') {
      syncFollowTarget(0)
    } else {
      api.tickPosition = 0
    }
  }

  function applyRestoreState() {
    const api = apiRef.current
    const restore = restoreRef.current
    if (!api || !api.isReadyForPlayback) return
    if (restore) {
      api.playbackSpeed = restore.playbackSpeed
      api.metronomeVolume = metronomeVolume
      api.countInVolume = countInVolume
      api.tickPosition = restore.lastTick
      setSpeed(restore.playbackSpeed)
      setLoopA(restore.loopStart)
      setLoopB(restore.loopEnd)
      setLooping(restore.loopStart !== null && restore.loopEnd !== null)
      if (restore.loopStart !== null && restore.loopEnd !== null) {
        api.playbackRange = { startTick: restore.loopStart, endTick: restore.loopEnd }
        api.isLooping = true
      }
    }
    if (!initialTrackAppliedRef.current && api.score) {
      const selectedIndex =
        restore && restore.selectedTrackIndexes.length > 0
          ? restore.selectedTrackIndexes[0]
          : pickDefaultTrackIndex(api.score.tracks)
      renderSelection(selectedIndex, displayMode)
      initialTrackAppliedRef.current = true
    }
    if (restore && api.score) {
      const barIndex = findMasterBarIndex(api.score, restore.lastTick)
      applyPage(Math.floor(barIndex / PAGE_BARS), true)
    }
    restoreRef.current = null
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      const api = apiRef.current
      const songId = activeSongIdRef.current
      if (!api || !songId || !playingRef.current || activePdf) return
      void patchSong(songId, {
        lastTick: api.tickPosition,
        playbackSpeed: api.playbackSpeed,
        loopStart: loopA,
        loopEnd: loopB,
        selectedTrackIndexes: activeTrackIndex === null ? [] : [activeTrackIndex],
      })
    }, 5000)

    return () => window.clearInterval(timer)
  }, [activePdf, activeTrackIndex, loopA, loopB])

  useEffect(() => {
    const saveOnLeave = () => {
      const api = apiRef.current
      const songId = activeSongIdRef.current
      if (!api || !songId || activePdf) return
      void patchSong(songId, {
        lastTick: api.tickPosition,
        playbackSpeed: api.playbackSpeed,
        loopStart: loopA,
        loopEnd: loopB,
        selectedTrackIndexes: activeTrackIndex === null ? [] : [activeTrackIndex],
      })
    }
    window.addEventListener('beforeunload', saveOnLeave)
    return () => window.removeEventListener('beforeunload', saveOnLeave)
  }, [activePdf, activeTrackIndex, loopA, loopB])

  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    api.playbackSpeed = speed
  }, [speed])

  useEffect(() => {
    practiceModeRef.current = practiceMode
  }, [practiceMode])

  useEffect(() => {
    displayModeRef.current = displayMode
  }, [displayMode])

  useEffect(() => {
    const handleResize = () => {
      const api = apiRef.current
      const next = currentBarsPerRow()
      if (!api || api.settings.display.barsPerRow === next) return
      api.settings.display.barsPerRow = next
      api.updateSettings()
      api.render()
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    applyMixState()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutedTrackIndexes, soloTrackIndexes])

  useEffect(
    () => () => {
      cancelAnimationFrame(micAnimationRef.current)
      micStreamRef.current?.getTracks().forEach((track) => track.stop())
      void micContextRef.current?.close()
      micStreamRef.current = null
      micContextRef.current = null
      micAnalyserRef.current = null
      micSamplesRef.current = null
    },
    [],
  )

  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    api.metronomeVolume = metronomeVolume
  }, [metronomeVolume])

  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    api.countInVolume = countInVolume
  }, [countInVolume])

  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    if (loopA !== null && loopB !== null && loopA < loopB) {
      api.playbackRange = { startTick: loopA, endTick: loopB }
      api.isLooping = looping
    } else {
      api.playbackRange = null
      api.isLooping = false
    }
  }, [loopA, loopB, looping])

  async function importScoreFile(file: File) {
    const api = apiRef.current
    if (!api) return
    const data = await file.arrayBuffer()
    const format = fileFormat(file.name)
    const songId = createId()
    const record: SongRecord = {
      id: songId,
      title: file.name.replace(/\.[^.]+$/, ''),
      fileName: file.name,
      format,
      size: file.size,
      data,
      importedAt: Date.now(),
      updatedAt: Date.now(),
      favorite: 0,
      lastTick: 0,
      playbackSpeed: 1,
      loopStart: null,
      loopEnd: null,
      selectedTrackIndexes: [],
      lastPage: format === 'pdf' ? 1 : undefined,
    }
    if (format === 'pdf') {
      await saveSong(record)
      await refreshSongs()
      activeSongIdRef.current = songId
      setActiveSongId(songId)
      setActivePdf({ id: songId, title: record.title, data, lastPage: 1 })
      return
    }

    setActivePdf(null)
    pendingImportRef.current = {
      id: songId,
      fileName: file.name,
      format,
      size: file.size,
      record,
    }
    api.load(data)
  }

  async function openSong(song: SongRecord) {
    const api = apiRef.current
    if (!api) return
    const stored = (await getSong(song.id)) ?? song
    activeSongIdRef.current = stored.id
    setActiveSongId(stored.id)

    if (stored.format === 'pdf') {
      setActivePdf({
        id: stored.id,
        title: stored.title,
        data: stored.data,
        lastPage: stored.lastPage ?? 1,
      })
      return
    }

    setActivePdf(null)
    pendingImportRef.current = {
      id: stored.id,
      fileName: stored.fileName,
      format: stored.format,
      size: stored.size,
      existing: stored,
    }
    restoreRef.current = {
      lastTick: stored.lastTick,
      playbackSpeed: stored.playbackSpeed,
      loopStart: stored.loopStart,
      loopEnd: stored.loopEnd,
      selectedTrackIndexes: stored.selectedTrackIndexes,
    }
    api.load(stored.data)
  }

  async function openSongById(id: string) {
    const song = await getSong(id)
    if (!song) return
    setAudioToolOpen(false)
    await openSong(song)
  }

  async function toggleFavorite(song: SongRecord) {
    await patchSong(song.id, { favorite: song.favorite ? 0 : 1 })
    await refreshSongs()
  }

  async function deleteSong(song: SongRecord) {
    await removeSong(song.id)
    if (activeSongIdRef.current === song.id) {
      activeSongIdRef.current = null
      setActiveSongId(null)
      setActivePdf(null)
      restoreRef.current = null
      originalTracksRef.current = null
      void loadSampleScore()
    }
    await refreshSongs()
  }

  async function loadSampleScore() {
    const api = apiRef.current
    if (!api) return
    restoreRef.current = null
    activeSongIdRef.current = null
    setActiveSongId(null)
    setActivePdf(null)
    originalTracksRef.current = null
    pageRef.current = 0
    setPageIndex(0)
    setError('')
    try {
      const response = await fetch(SAMPLE_FILE)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const buffer = await response.arrayBuffer()
      pendingImportRef.current = {
        id: 'sample-smoke-on-the-water',
        fileName: 'Smoke On The Water.gp5',
        format: 'gp5',
        size: buffer.byteLength,
        sample: true,
      }
      api.load(buffer)
    } catch (caught) {
      setError(
        caught instanceof Error ? `示例曲谱加载失败：${caught.message}` : '示例曲谱加载失败',
      )
    }
  }

  function toggleTrackMute(index: number) {
    const next = new Set(mutedTrackIndexes)
    const nextSolo = new Set(soloTrackIndexes)
    if (next.has(index)) {
      next.delete(index)
    } else {
      next.add(index)
      nextSolo.delete(index)
    }
    setMutedTrackIndexes(next)
    setSoloTrackIndexes(nextSolo)
    applyMixState(next, nextSolo)
  }

  function toggleTrackSolo(index: number) {
    const next = new Set(soloTrackIndexes)
    const nextMuted = new Set(mutedTrackIndexes)
    if (next.has(index)) {
      next.delete(index)
    } else {
      next.add(index)
      nextMuted.delete(index)
    }
    setSoloTrackIndexes(next)
    setMutedTrackIndexes(nextMuted)
    applyMixState(nextMuted, next)
  }

  async function handlePdfPage(page: number) {
    const songId = activePdf?.id
    if (!songId) return
    await patchSong(songId, { lastPage: page })
  }

  const activeSong = songs.find((song) => song.id === activeSongId) ?? null
  const canTab =
    activeTrackIndex === null
      ? originalStaffDisplayRef.current.some((staffs) => staffs.some((staff) => staff.tab))
      : originalStaffDisplayRef.current[activeTrackIndex]?.some((staff) => staff.tab) ?? false
  const canScore =
    activeTrackIndex === null
      ? originalStaffDisplayRef.current.some((staffs) => staffs.some((staff) => staff.score))
      : originalStaffDisplayRef.current[activeTrackIndex]?.some((staff) => staff.score) ?? false
  const activeInstrument =
    activeTrackIndex === null ? null : detectInstrument(tracks[activeTrackIndex])
  const pageStartBar = pageIndex * PAGE_BARS + 1
  const pageEndBar = Math.min((pageIndex + 1) * PAGE_BARS, score?.masterBars.length ?? PAGE_BARS)

  return (
    <div
      className={`module score-module ${libraryCollapsed ? 'library-collapsed' : ''} ${
        practiceMode === 'follow' ? 'follow-mode' : ''
      }`}
    >
      <section className="panel score-library-panel">
        {libraryCollapsed ? (
          <button
            className="button compact expand-library-button"
            type="button"
            aria-label="展开曲库"
            onClick={() => setLibraryCollapsed(false)}
          >
            曲库
          </button>
        ) : (
          <>
            <div className="section-heading compact-heading">
              <div>
                <p className="eyebrow">Library</p>
                <h2>曲库</h2>
              </div>
              <button
                className="icon-button collapse-button"
                type="button"
                aria-label="收起曲库"
                onClick={() => setLibraryCollapsed(true)}
              >
                «
              </button>
            </div>
            <div className="toolbar compact-toolbar">
              <button
                className="button primary compact"
                type="button"
                onClick={() => fileInputRef.current?.click()}
              >
                导入 GP / PDF
              </button>
              <button
                className="button compact"
                type="button"
                title="载入内置示例曲谱 Smoke On The Water"
                onClick={() => void loadSampleScore()}
              >
                示例曲谱
              </button>
              <button
                className="button compact"
                type="button"
                onClick={() => setAudioToolOpen(true)}
              >
                音频转谱 Beta
              </button>
            </div>
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              accept=".gp3,.gp4,.gp5,.gpx,.gp,.xml,.musicxml,.capx,.alphatex,.pdf,application/pdf"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void importScoreFile(file)
                event.target.value = ''
              }}
            />

            {songs.length === 0 ? (
              <p className="empty-state compact-empty">
                还没有曲谱。导入 GP5、GP、MusicXML 或 PDF 开始练习。
              </p>
            ) : (
              <div className="song-list compact-list">
                {songs.map((song, songIndex) => (
                  <article
                    key={song.id}
                    className={`song-card ${song.id === activeSongId ? 'active' : ''}`}
                    style={{ '--item-index': songIndex } as CSSProperties}
                  >
                    <button
                      className="song-main"
                      type="button"
                      onClick={() => void openSong(song)}
                    >
                      <strong>{song.title}</strong>
                      <span>
                        {song.format.toUpperCase()} · {(song.size / 1024 / 1024).toFixed(1)} MB
                        {song.format === 'pdf' && song.lastPage ? ` · P${song.lastPage}` : ''}
                      </span>
                    </button>
                    <button
                      className={`icon-button ${song.favorite ? 'is-favorite' : ''}`}
                      type="button"
                      aria-label={song.favorite ? '取消收藏' : '收藏'}
                      onClick={() => void toggleFavorite(song)}
                    >
                      {song.favorite ? '★' : '☆'}
                    </button>
                    <button
                      className="icon-button danger"
                      type="button"
                      aria-label="删除曲谱"
                      onClick={() => void deleteSong(song)}
                    >
                      ×
                    </button>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <section className="panel player-panel compact-player">
        <div className="player-header compact-header">
          <div>
            <p className="eyebrow">Practice</p>
            <h2>{activePdf?.title || score?.title || activeSong?.title || SAMPLE_TITLE}</h2>
            <p className="muted">
              {activePdf
                ? `PDF 曲谱 · 当前第 ${activePdf.lastPage} 页`
                : score
                  ? `${score.tracks.length} 条音轨 · ${score.tempo || '—'} BPM · 第 ${pageStartBar}–${pageEndBar} 小节 · ${formatClock(position.currentTime / 1000)} / ${formatClock(position.endTime / 1000)}`
                  : '正在初始化曲谱播放器…'}
            </p>
          </div>
          <div className="player-status">
            {!activePdf && (
              <span className={`status-pill ${playerReady ? 'ready' : ''}`}>
                {playerReady ? '播放器已就绪' : '加载音源中'}
              </span>
            )}
            {activeNotes.length > 0 && (
              <span className="active-notes" key={activeNotes.join('-')}>
                正在弹奏：{activeNotes.join(' ')}
              </span>
            )}
            {playing && activeInstrument && (
              <span
                className="instrument-badge"
                title={`当前乐器：${
                  activeInstrument === 'guitar'
                    ? '吉他'
                    : activeInstrument === 'bass'
                      ? '贝斯'
                      : activeInstrument === 'keyboard'
                        ? '键盘'
                        : '鼓'
                }`}
              >
                <InstrumentIcon kind={activeInstrument} />
              </span>
            )}
            {!activePdf && practiceMode === 'follow' && followTarget && (
              <span className="active-notes">
                请弹奏：{followTarget.names.join(' ')}
                {followSkipped > 0 && (
                  <em className="follow-skip-hint">（已跳过 {followSkipped} 个闷音）</em>
                )}
              </span>
            )}
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}

        {!activePdf && (
          <>
            <div className="practice-toolbar">
              <div className="segmented compact-segmented" aria-label="练习模式">
                <button
                  type="button"
                  className={practiceMode === 'play' ? 'active' : ''}
                  onClick={() => changePracticeMode('play')}
                >
                  演奏模式
                </button>
                <button
                  type="button"
                  className={practiceMode === 'follow' ? 'active' : ''}
                  onClick={() => changePracticeMode('follow')}
                >
                  跟练模式
                </button>
                <button
                  type="button"
                  className={practiceMode === 'accompany' ? 'active' : ''}
                  onClick={() => changePracticeMode('accompany')}
                >
                  陪练模式
                </button>
              </div>
              {practiceMode !== 'play' && (
                <>
                  <button
                    className={`button compact ${micOn ? 'danger' : ''}`}
                    type="button"
                    onClick={() =>
                      micOn ? stopScoreMicrophone() : void startScoreMicrophone()
                    }
                  >
                    {micOn ? '关闭麦克风' : '启用麦克风'}
                  </button>
                  {detectedNote && (
                    <span className="detected-note" key={detectedNote}>
                      识别：{detectedNote}
                    </span>
                  )}
                  {practiceMode === 'follow' ? (
                    <div className="live-score">
                      <strong>
                        进度 {liveScore.hits} / {liveScore.total || '—'}
                      </strong>
                    </div>
                  ) : (
                    <div className="live-score">
                      <span>音准 {liveScore.pitch}%</span>
                      <span>节奏 {liveScore.rhythm}%</span>
                      <strong>综合 {liveScore.overall}%</strong>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="page-toolbar">
              <button
                className="button compact"
                type="button"
                disabled={pageIndex <= 0}
                onClick={() => applyPage(pageIndex - 1, true)}
              >
                上一页
              </button>
              <strong>
                第 {pageIndex + 1} / {pageCount} 页
              </strong>
              <button
                className="button compact"
                type="button"
                disabled={pageIndex >= pageCount - 1}
                onClick={() => applyPage(pageIndex + 1, true)}
              >
                下一页
              </button>
              <span className="page-hint">每页 {PAGE_BARS} 小节 · 播放时自动翻页</span>
              <div className="segmented compact-segmented" aria-label="谱面显示模式">
                <button
                  type="button"
                  className={displayMode === 'tab' ? 'active' : ''}
                  disabled={!canTab}
                  onClick={() =>
                    applyDisplayMode(
                      'tab',
                      activeTrackIndex === null ? null : tracks[activeTrackIndex],
                    )
                  }
                >
                  六线谱
                </button>
                <button
                  type="button"
                  className={displayMode === 'scoreTab' ? 'active' : ''}
                  disabled={!canTab || !canScore}
                  onClick={() =>
                    applyDisplayMode(
                      'scoreTab',
                      activeTrackIndex === null ? null : tracks[activeTrackIndex],
                    )
                  }
                >
                  谱+六线
                </button>
                <button
                  type="button"
                  className={displayMode === 'score' ? 'active' : ''}
                  disabled={!canScore}
                  onClick={() =>
                    applyDisplayMode(
                      'score',
                      activeTrackIndex === null ? null : tracks[activeTrackIndex],
                    )
                  }
                >
                  五线谱
                </button>
              </div>
            </div>

            <div className="sheet-frame">
              <div className="sheet-progress" aria-hidden="true">
                <span style={{ transform: `scaleX(${sheetProgress})` }} />
              </div>
              <div
                className={`alphaTab-scroll large-score ${
                  pageTurn === 'next'
                    ? 'is-turn-next'
                    : pageTurn === 'prev'
                      ? 'is-turn-prev'
                      : ''
                }`}
                ref={scrollRef}
                style={{ height: `${scoreHeight}px` }}
                onScroll={(event) => {
                  const element = event.currentTarget
                  const range = element.scrollHeight - element.clientHeight
                  setSheetProgress(range > 0 ? element.scrollTop / range : 0)
                }}
              >
                <div className="alphaTab-target" ref={renderTargetRef} />
              </div>
              <div
                className="score-resize-handle"
                role="separator"
                aria-orientation="horizontal"
                aria-label="拖动调整曲谱窗口高度"
                tabIndex={0}
                onPointerDown={handleResizePointerDown}
                onPointerMove={handleResizePointerMove}
                onPointerUp={handleResizePointerUp}
                onPointerCancel={handleResizePointerUp}
                onKeyDown={handleResizeKey}
              >
                <span />
              </div>
            </div>
          </>
        )}

        {activePdf && (
          <PdfScoreViewer
            data={activePdf.data}
            title={activePdf.title}
            initialPage={activePdf.lastPage}
            onPageChange={(page) => {
              setActivePdf((current) => (current ? { ...current, lastPage: page } : current))
              void handlePdfPage(page)
            }}
          />
        )}

        {!activePdf && (
          <>
            <div className="progress-row" aria-label="曲谱播放进度">
              <span className="time-label">{formatClock(position.currentTime / 1000)}</span>
              <input
                className="progress-range"
                type="range"
                min={0}
                max={Math.max(1, position.endTick)}
                step={1}
                value={Math.min(position.currentTick, position.endTick)}
                onChange={(event) => {
                  const api = apiRef.current
                  const nextTick = Number(event.target.value)
                  if (api) api.tickPosition = nextTick
                  setPosition((previous) => ({ ...previous, currentTick: nextTick }))
                }}
              />
              <span className="time-label">{formatClock(position.endTime / 1000)}</span>
              <button className="button compact" type="button" onClick={locateCurrentProgress}>
                定位当前
              </button>
            </div>

            <div className="transport-row compact-row">
              <button
                className="button primary transport compact"
                type="button"
                disabled={!playerReady || practiceMode === 'follow'}
                onClick={() => apiRef.current?.playPause()}
              >
                {practiceMode === 'follow' ? '跟练中' : playing ? '暂停' : '播放'}
              </button>
              <button
                className="button compact"
                type="button"
                disabled={!playerReady}
                onClick={() => {
                  const api = apiRef.current
                  if (!api) return
                  api.stop()
                  api.tickPosition = 0
                }}
              >
                回到开头
              </button>
              <button
                className="button compact"
                type="button"
                disabled={!playerReady}
                onClick={() => {
                  const api = apiRef.current
                  if (api) api.tickPosition = Math.max(0, api.tickPosition - 2 * 960)
                }}
              >
                −2 拍
              </button>
              <button
                className="button compact"
                type="button"
                disabled={!playerReady}
                onClick={() => {
                  const api = apiRef.current
                  if (api) api.tickPosition = api.tickPosition + 2 * 960
                }}
              >
                +2 拍
              </button>
            </div>

            <div className="control-grid compact-controls">
              <label>
                <span>速度 {Math.round(speed * 100)}%</span>
                <input
                  type="range"
                  min="0.25"
                  max="2"
                  step="0.05"
                  value={speed}
                  onChange={(event) => setSpeed(Number(event.target.value))}
                />
              </label>
              <label>
                <span>节拍器 {Math.round(metronomeVolume * 100)}%</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={metronomeVolume}
                  onChange={(event) => setMetronomeVolume(Number(event.target.value))}
                />
              </label>
              <label>
                <span>预备拍</span>
                <select
                  value={countInVolume}
                  onChange={(event) => setCountInVolume(Number(event.target.value))}
                >
                  <option value={0}>关闭</option>
                  <option value={0.6}>开启</option>
                </select>
              </label>
            </div>

            <div className="loop-row compact-row">
              <button
                className="button compact"
                type="button"
                onClick={() => setLoopA(apiRef.current?.tickPosition ?? 0)}
              >
                A {loopA === null ? '未设置' : `${(loopA / 960).toFixed(1)} 拍`}
              </button>
              <button
                className="button compact"
                type="button"
                onClick={() => setLoopB(apiRef.current?.tickPosition ?? 0)}
              >
                B {loopB === null ? '未设置' : `${(loopB / 960).toFixed(1)} 拍`}
              </button>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={looping}
                  onChange={(event) => setLooping(event.target.checked)}
                />
                循环片段
              </label>
              <button
                className="button ghost compact"
                type="button"
                onClick={() => {
                  setLoopA(null)
                  setLoopB(null)
                  setLooping(false)
                }}
              >
                清除
              </button>
            </div>

            {tracks.length > 0 && (
              <div className="track-list compact-tracks">
                <button
                  className={`track-chip ${activeTrackIndex === null ? 'active' : ''}`}
                  type="button"
                  onClick={() => selectTrack(null)}
                >
                  全部音轨
                </button>
                {tracks.map((track, index) => (
                  <span
                    key={`${track.name}-${index}`}
                    className={`track-chip ${activeTrackIndex === index ? 'active' : ''}`}
                  >
                    <button
                      type="button"
                      className="track-name"
                      onClick={() => selectTrack(index)}
                    >
                      {track.name || `音轨 ${index + 1}`}
                    </button>
                    <button
                      type="button"
                      className={mutedTrackIndexes.has(index) ? 'is-on' : ''}
                      aria-pressed={mutedTrackIndexes.has(index)}
                      title="静音该音轨（全部音轨模式下最明显）"
                      onClick={() => toggleTrackMute(index)}
                    >
                      M
                    </button>
                    <button
                      type="button"
                      className={soloTrackIndexes.has(index) ? 'is-on' : ''}
                      aria-pressed={soloTrackIndexes.has(index)}
                      title="独奏该音轨"
                      onClick={() => toggleTrackSolo(index)}
                    >
                      S
                    </button>
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {practiceSummary && (
        <div className="score-summary-overlay" role="dialog" aria-label="陪练评分">
          <div className="score-summary-card">
            <p className="eyebrow">陪练评分</p>
            <strong className="summary-score">{practiceSummary.overall}%</strong>
            <p className="muted">
              综合熟练度 · {practiceSummary.hits} / {practiceSummary.total} 个音符命中
            </p>
            <div className="summary-breakdown">
              <div>
                <strong>{practiceSummary.pitch}%</strong>
                <span>音准</span>
              </div>
              <div>
                <strong>{practiceSummary.rhythm}%</strong>
                <span>节奏</span>
              </div>
              <div>
                <strong>{Math.round(practiceSummary.averageMs)} ms</strong>
                <span>平均偏差</span>
              </div>
            </div>
            <button
              className="button primary"
              type="button"
              onClick={() => setPracticeSummary(null)}
            >
              继续练习
            </button>
          </div>
        </div>
      )}

      {audioToolOpen && (
        <div className="tool-modal-overlay" role="dialog" aria-label="音频转谱">
          <div className="tool-modal-card">
            <button
              className="icon-button modal-close"
              type="button"
              aria-label="关闭音频转谱"
              onClick={() => setAudioToolOpen(false)}
            >
              ×
            </button>
            <AudioToMidiPanel
              onCreated={() => void refreshSongs()}
              onOpen={(id) => void openSongById(id)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
