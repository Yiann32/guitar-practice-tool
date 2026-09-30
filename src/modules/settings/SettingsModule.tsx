import { useEffect, useRef, useState } from 'react'
import { db } from '../../data/db'
import { downloadBlob, exportBackup, importBackup } from '../../lib/backup'

export default function SettingsModule() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [songCount, setSongCount] = useState(0)
  const [bytes, setBytes] = useState(0)
  const [message, setMessage] = useState('')

  async function refreshStats() {
    const songs = await db.songs.toArray()
    setSongCount(songs.length)
    setBytes(songs.reduce((sum, song) => sum + song.size, 0))
  }

  useEffect(() => {
    void refreshStats()
  }, [])

  async function handleExport() {
    setMessage('正在生成备份…')
    const blob = await exportBackup()
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    await downloadBlob(blob, `guitar-practice-backup-${stamp}.zip`)
    setMessage('备份已生成并开始下载。')
  }

  async function handleImport(file: File) {
    setMessage('正在恢复备份…')
    try {
      const imported = await importBackup(file)
      await refreshStats()
      setMessage(`备份导入完成，共恢复 ${imported} 份曲谱。`)
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : String(caught))
    }
  }

  return (
    <div className="module settings-module">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Data</p>
            <h2>数据与备份</h2>
            <p className="muted">
              曲谱和进度保存在当前浏览器的 IndexedDB 中，清除浏览器数据前请先导出备份。
            </p>
          </div>
        </div>
        <div className="stat-row">
          <div>
            <strong>{songCount}</strong>
            <span>曲谱数量</span>
          </div>
          <div>
            <strong>{(bytes / 1024 / 1024).toFixed(1)} MB</strong>
            <span>曲谱体积</span>
          </div>
          <button className="button primary" type="button" onClick={() => void handleExport()}>
            导出备份
          </button>
          <button
            className="button"
            type="button"
            onClick={() => inputRef.current?.click()}
          >
            导入备份
          </button>
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            accept=".zip,application/zip"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void handleImport(file)
              event.target.value = ''
            }}
          />
        </div>
        {message && <p className="muted">{message}</p>}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">About</p>
            <h2>当前 Web 版本</h2>
          </div>
        </div>
        <div className="about-grid">
          <div>
            <strong>曲谱引擎</strong>
            <span>alphaTab 1.8 · Guitar Pro 3–8 / MusicXML</span>
          </div>
          <div>
            <strong>MIDI 音源</strong>
            <span>SONiVOX SoundFont，随应用离线加载</span>
          </div>
          <div>
            <strong>实时识别</strong>
            <span>YIN 单音检测 · 吉他范围 70–1400 Hz</span>
          </div>
          <div>
            <strong>音频转 MIDI</strong>
            <span>Spotify Basic Pitch · Apache-2.0</span>
          </div>
        </div>
        <p className="muted small">
          当前阶段先在网页端验证播放、指板识别和转 MIDI；Android 打包将在网页流程稳定后接入。
        </p>
      </section>
    </div>
  )
}
