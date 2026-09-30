import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

interface PdfScoreViewerProps {
  data: ArrayBuffer
  title: string
  initialPage: number
  onPageChange: (page: number) => void
}

interface MetronomeState {
  running: boolean
  bpm: number
  beatsPerBar: number
}

export default function PdfScoreViewer({
  data,
  title,
  initialPage,
  onPageChange,
}: PdfScoreViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const documentRef = useRef<PDFDocumentProxy | null>(null)
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null)
  const metronomeRef = useRef<{
    context: AudioContext
    nextTick: number
    beat: number
    timer: number
  } | null>(null)
  const onPageChangeRef = useRef(onPageChange)
  onPageChangeRef.current = onPageChange
  const [page, setPage] = useState(Math.max(1, initialPage || 1))
  const [totalPages, setTotalPages] = useState(0)
  const [containerWidth, setContainerWidth] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [metronome, setMetronome] = useState<MetronomeState>({
    running: false,
    bpm: 88,
    beatsPerBar: 4,
  })

  useEffect(() => {
    let cancelled = false
    const loadingTask = pdfjsLib.getDocument({ data: data.slice(0) })
    setLoading(true)
    setError('')

    void loadingTask.promise
      .then((document) => {
        if (cancelled) {
          return
        }
        documentRef.current = document
        setTotalPages(document.numPages)
        setPage((current) => Math.min(Math.max(1, current), document.numPages))
      })
      .catch((caught: unknown) => {
        if (cancelled) return
        setError(caught instanceof Error ? caught.message : 'PDF 打开失败。')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      renderTaskRef.current?.cancel()
      documentRef.current = null
      void loadingTask.destroy()
    }
  }, [data])

  useEffect(() => {
    const document = documentRef.current
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!document || !canvas || !container || totalPages === 0) return

    let disposed = false
    renderTaskRef.current?.cancel()

    void document
      .getPage(page)
      .then((pdfPage) => {
        if (disposed) return
        const baseViewport = pdfPage.getViewport({ scale: 1 })
        const fitScale = ((containerWidth || container.clientWidth) - 44) / baseViewport.width
        const viewport = pdfPage.getViewport({ scale: Math.max(0.4, fitScale * zoom) })
        const outputScale = window.devicePixelRatio || 1
        canvas.width = Math.floor(viewport.width * outputScale)
        canvas.height = Math.floor(viewport.height * outputScale)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        const context = canvas.getContext('2d')
        if (!context) return
        context.setTransform(outputScale, 0, 0, outputScale, 0, 0)
        context.clearRect(0, 0, viewport.width, viewport.height)
        const task = pdfPage.render({
          canvasContext: context,
          viewport,
          canvas,
        })
        renderTaskRef.current = task
        return task.promise
      })
      .catch((caught: unknown) => {
        if (!disposed && (caught as { name?: string })?.name !== 'RenderingCancelledException') {
          setError(caught instanceof Error ? caught.message : 'PDF 页面渲染失败。')
        }
      })

    return () => {
      disposed = true
      renderTaskRef.current?.cancel()
    }
  }, [containerWidth, page, zoom, totalPages])

  useEffect(() => {
    onPageChangeRef.current(page)
  }, [page])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? container.clientWidth
      setContainerWidth(width)
    })
    observer.observe(container)
    setContainerWidth(container.clientWidth)
    return () => observer.disconnect()
  }, [])

  function stopMetronome() {
    const current = metronomeRef.current
    if (current) {
      window.clearInterval(current.timer)
      void current.context.close()
      metronomeRef.current = null
    }
    setMetronome((previous) => ({ ...previous, running: false }))
  }

  function startMetronome() {
    stopMetronome()
    const context = new AudioContext({ latencyHint: 'interactive' })
    const state = {
      context,
      nextTick: context.currentTime + 0.08,
      beat: 0,
      timer: 0,
    }
    const schedule = () => {
      const interval = 60 / Math.max(30, metronome.bpm)
      while (state.nextTick < context.currentTime + 0.25) {
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        oscillator.frequency.value = state.beat % metronome.beatsPerBar === 0 ? 1320 : 880
        gain.gain.setValueAtTime(state.beat % metronome.beatsPerBar === 0 ? 0.9 : 0.55, state.nextTick)
        gain.gain.exponentialRampToValueAtTime(0.001, state.nextTick + 0.055)
        oscillator.connect(gain)
        gain.connect(context.destination)
        oscillator.start(state.nextTick)
        oscillator.stop(state.nextTick + 0.06)
        state.nextTick += interval
        state.beat += 1
      }
    }
    schedule()
    state.timer = window.setInterval(schedule, 80)
    metronomeRef.current = state
    setMetronome((previous) => ({ ...previous, running: true }))
  }

  useEffect(
    () => () => {
      renderTaskRef.current?.cancel()
      const current = metronomeRef.current
      if (current) {
        window.clearInterval(current.timer)
        void current.context.close()
      }
    },
    [],
  )

  return (
    <div className="pdf-practice">
      <div className="pdf-toolbar">
        <div className="pdf-page-controls">
          <button
            className="button compact"
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            上一页
          </button>
          <strong>
            {page} / {totalPages || '—'}
          </strong>
          <button
            className="button compact"
            type="button"
            disabled={totalPages === 0 || page >= totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            下一页
          </button>
        </div>
        <div className="pdf-zoom-controls">
          <button
            className="button compact"
            type="button"
            onClick={() => setZoom((current) => Math.max(0.6, current - 0.1))}
          >
            −
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            className="button compact"
            type="button"
            onClick={() => setZoom((current) => Math.min(2.2, current + 0.1))}
          >
            +
          </button>
        </div>
        <div className="pdf-metronome">
          <button
            className={`button compact ${metronome.running ? 'danger' : 'primary'}`}
            type="button"
            onClick={() => (metronome.running ? stopMetronome() : startMetronome())}
          >
            {metronome.running ? '停止节拍' : '节拍器'}
          </button>
          <label>
            BPM
            <input
              type="number"
              min={30}
              max={240}
              value={metronome.bpm}
              onChange={(event) =>
                setMetronome((previous) => ({
                  ...previous,
                  bpm: Number(event.target.value) || 88,
                }))
              }
            />
          </label>
          <label>
            拍号
            <select
              value={metronome.beatsPerBar}
              onChange={(event) =>
                setMetronome((previous) => ({
                  ...previous,
                  beatsPerBar: Number(event.target.value),
                }))
              }
            >
              <option value={2}>2/4</option>
              <option value={3}>3/4</option>
              <option value={4}>4/4</option>
              <option value={6}>6/8</option>
            </select>
          </label>
        </div>
      </div>

      <div className="pdf-notice">
        <strong>{title}</strong>
        <span>PDF 只能分页跟弹和节拍器练习，无法解析音符或自动高亮/播放。</span>
      </div>

      {error && <p className="error-text">{error}</p>}
      <div className="pdf-page-scroll" ref={containerRef}>
        {loading && <p className="muted pdf-loading">正在加载 PDF…</p>}
        <canvas ref={canvasRef} className="pdf-canvas" />
      </div>
    </div>
  )
}
