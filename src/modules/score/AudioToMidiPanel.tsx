import { useRef, useState } from 'react'
import { createId, saveSong } from '../../data/db'
import { notesToGpScore } from '../../lib/audioToScore'
import { transcribeAudio } from '../../lib/audioToMidi'
import type { SupportedInstrument } from '../../lib/instrument'
import { midiToFullName } from '../../lib/music'
import type { SongRecord, TranscribeResult } from '../../types'

interface AudioToMidiPanelProps {
  onCreated?: (songId: string) => void
  onOpen?: (songId: string) => void
}

export default function AudioToMidiPanel({
  onCreated,
  onOpen,
}: AudioToMidiPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [progress, setProgress] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<TranscribeResult | null>(null)
  const [createdSong, setCreatedSong] = useState<{ id: string; title: string } | null>(
    null,
  )
  const [instrument, setInstrument] = useState<SupportedInstrument>('guitar')

  async function handleFile(file: File) {
    setBusy(true)
    setError('')
    setResult(null)
    setCreatedSong(null)
    setProgress(0)
    setFileName(file.name)

    try {
      const nextResult = await transcribeAudio(file, setProgress)
      if (nextResult.notes.length === 0) {
        throw new Error('没有识别到稳定的音高，请尝试更清晰、单一乐器的录音。')
      }

      const instrumentLabel =
        instrument === 'guitar'
          ? '吉他'
          : instrument === 'bass'
            ? '贝斯'
            : instrument === 'keyboard'
              ? '键盘'
              : '鼓'
      const title = `${file.name.replace(/\.[^.]+$/, '') || '音频转谱'} · ${instrumentLabel}音频转谱`
      const gpScore = notesToGpScore(nextResult.notes, title, 120, instrument)
      const buffer = gpScore.bytes.buffer.slice(
        gpScore.bytes.byteOffset,
        gpScore.bytes.byteOffset + gpScore.bytes.byteLength,
      ) as ArrayBuffer
      const id = createId()
      const record: SongRecord = {
        id,
        title,
        fileName: `${title}.gp`,
        format: 'gp',
        size: gpScore.bytes.length,
        data: buffer,
        importedAt: Date.now(),
        updatedAt: Date.now(),
        favorite: 0,
        lastTick: 0,
        playbackSpeed: 1,
        loopStart: null,
        loopEnd: null,
        selectedTrackIndexes: [],
      }
      await saveSong(record)
      setResult(nextResult)
      setCreatedSong({ id, title })
      onCreated?.(id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel audio-tool-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Audio to Score · Beta</p>
          <h2>音频转谱 Beta</h2>
          <p className="muted">
            上传单件乐器录音，浏览器会完成音高识别、量化和 MusicXML
            生成，并直接转换成 GP7 曲谱加入曲库。
          </p>
        </div>
        <button
          className="button primary"
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? `识别中 ${Math.round(progress * 100)}%` : '选择音频'}
        </button>
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept=".mp3,.wav,.ogg,.flac,.m4a,audio/*"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void handleFile(file)
            event.target.value = ''
          }}
        />
      </div>

      <div className="beta-note">
        <span>BETA</span>
        <p>
          适合单件乐器录音。鼓、人声和复杂混音只做参考；转谱结果会量化到
          1/16 音符。
        </p>
      </div>

      <div className="transcription-options">
        <span>目标乐器</span>
        <div className="segmented compact-segmented" aria-label="选择转谱乐器">
          {(
            [
              ['guitar', '吉他'],
              ['bass', '贝斯'],
              ['keyboard', '键盘'],
              ['drums', '鼓'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={instrument === value ? 'active' : ''}
              disabled={busy}
              onClick={() => setInstrument(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <small>
          {instrument === 'guitar' || instrument === 'bass'
            ? '生成六线谱，并按标准调弦自动分配弦品。'
            : '生成五线谱；鼓类音频仅作参考。'}
        </small>
      </div>

      {fileName && <p className="muted">当前文件：{fileName}</p>}
      {busy && (
        <div className="progress-track" aria-label="音频识别进度">
          <span style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
      {error && <p className="error-text">{error}</p>}

      {result && createdSong && (
        <div className="transcription-result">
          <div className="stat-row">
            <div>
              <strong>{result.notes.length}</strong>
              <span>识别音符</span>
            </div>
            <div>
              <strong>{result.durationSeconds.toFixed(1)}s</strong>
              <span>音频长度</span>
            </div>
            <div>
              <strong>GP7</strong>
              <span>已加入曲库</span>
            </div>
            <button
              className="button primary"
              type="button"
              onClick={() => onOpen?.(createdSong.id)}
            >
              打开曲谱
            </button>
            <button
              className="button"
              type="button"
              onClick={() => inputRef.current?.click()}
            >
              继续转谱
            </button>
          </div>
          <p className="muted">{createdSong.title}</p>
          <div className="note-preview">
            {result.notes.slice(0, 16).map((note, index) => (
              <span key={`${note.pitchMidi}-${note.startTimeSeconds}-${index}`}>
                {midiToFullName(note.pitchMidi)}
                <small>{note.startTimeSeconds.toFixed(2)}s</small>
              </span>
            ))}
            {result.notes.length > 16 && <span>…</span>}
          </div>
        </div>
      )}
    </section>
  )
}
