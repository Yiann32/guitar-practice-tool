import { useState, type CSSProperties } from 'react'
import type { AppTab } from './types'
import { withBase } from './lib/baseUrl'
import FretboardModule from './modules/fretboard/FretboardModule'
import ScoreModule from './modules/score/ScoreModule'
import SettingsModule from './modules/settings/SettingsModule'

const TABS: { id: AppTab; label: string; hint: string }[] = [
  { id: 'score', label: '曲谱练习', hint: '导入与跟弹' },
  { id: 'fretboard', label: '指板练习', hint: '音位与音阶' },
  { id: 'settings', label: '数据设置', hint: '备份与说明' },
]

export default function App() {
  const [tab, setTab] = useState<AppTab>('score')
  const activeIndex = Math.max(0, TABS.findIndex((item) => item.id === tab))

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <img src={withBase('icons/guitar.svg')} alt="" />
          </span>
          <div>
            <strong>吉他练习工具</strong>
            <small>曲谱 · 指板 · 音频</small>
          </div>
        </div>
        <nav
          className="top-nav"
          aria-label="主导航"
          style={{ '--tab-index': activeIndex } as CSSProperties}
        >
          <span className="nav-pill" aria-hidden="true" />
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tab === item.id ? 'active' : ''}
              aria-current={tab === item.id ? 'page' : undefined}
              onClick={() => setTab(item.id)}
            >
              <span>{item.label}</span>
              <small>{item.hint}</small>
            </button>
          ))}
        </nav>
      </header>

      <main className="app-main">
        <div className="module-stage" key={tab} data-tab={tab}>
          {tab === 'score' && <ScoreModule />}
          {tab === 'fretboard' && <FretboardModule />}
          {tab === 'settings' && <SettingsModule />}
        </div>
      </main>

      <nav
        className="bottom-nav"
        aria-label="移动端导航"
        style={{ '--tab-index': activeIndex } as CSSProperties}
      >
        <span className="nav-pill" aria-hidden="true" />
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? 'active' : ''}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
