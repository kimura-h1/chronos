import { useEffect, useState } from 'react'
import { Dashboard } from './pages/Dashboard'
import { ExperimentControl } from './pages/ExperimentControl'
import { ResultsAnalysis } from './pages/ResultsAnalysis'
import { Visualizer } from './pages/Visualizer'
import { AppProvider, useApp, type Tab } from './state'

const TABS: { id: Tab; label: string; code: string }[] = [
  { id: 'dashboard', label: '研究ダッシュボード', code: 'A' },
  { id: 'visualizer', label: '時空ビジュアライザ', code: 'B' },
  { id: 'control', label: '実験制御', code: 'C' },
  { id: 'analysis', label: '結果解析', code: 'D' },
]

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const iv = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(iv)
  }, [])
  return <span className="num">{now.toLocaleString('ja-JP', { hour12: false })}</span>
}

function Shell() {
  const { tab, setTab, online, jobs } = useApp()
  const running = jobs.filter((j) => j.status === 'running' || j.status === 'queued').length
  return (
    <div className="relative z-10 flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/95 backdrop-blur">
        <div className="flex items-center gap-6 px-5 py-2.5">
          <div className="flex items-baseline gap-3">
            <span className="text-lg font-bold tracking-[0.3em] text-accent">CHRONOS</span>
            <span className="text-[12px] text-ink-3">時間移動研究コンソール ・ 閉じた時間的曲線の検証</span>
          </div>
          <div className="ml-auto flex items-center gap-5 text-[12px] text-ink-2">
            <span className="flex items-center gap-1.5" data-testid="api-status">
              <span className={`h-2 w-2 rounded-full ${online === null ? 'bg-ink-3' : online ? 'bg-good' : 'bg-bad lamp-pulse'}`} />
              計算エンジン {online === null ? '接続中' : online ? 'オンライン' : 'オフライン'}
            </span>
            <span className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${running ? 'bg-accent lamp-pulse' : 'bg-ink-3'}`} />
              実行中 {running}
            </span>
            <Clock />
          </div>
        </div>
        <nav className="flex gap-1 px-4" aria-label="画面">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`}
              className={`relative -mb-px flex items-center gap-2 rounded-t border px-4 py-2 text-[13px] ${
                tab === t.id ? 'border-line border-b-panel bg-panel text-ink' : 'border-transparent text-ink-3 hover:text-ink-2'}`}>
              <span className={`num text-[10px] ${tab === t.id ? 'text-accent' : ''}`}>{t.code}</span>
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      {online === false && (
        <div className="mx-5 mt-4 rounded border border-bad/60 bg-bad/10 px-4 py-2 text-[13px] text-[#f08a8a]">
          計算エンジン（FastAPI, :8000）に接続できません。<code className="num">scripts/dev.sh</code> でバックエンドを起動してください。
        </div>
      )}
      <main className="flex-1 p-5">
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'visualizer' && <Visualizer />}
        {tab === 'control' && <ExperimentControl />}
        {tab === 'analysis' && <ResultsAnalysis />}
      </main>
      <footer className="border-t border-line px-5 py-2 text-[11px] text-ink-3">
        本システムの判定は与えられた計量内での数学的判定です。現実の時間移動が可能であることを示すものではありません（物理的実現性: 未確立）。単位系 c = G = 1、計量符号 (−,+,+,+)。
      </footer>
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
