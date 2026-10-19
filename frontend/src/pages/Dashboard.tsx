import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Constraint, JobSummary, Verification } from '../api/types'
import { Button, Empty, Panel, Stat, StatusPill, VerdictBadge } from '../components/ui'
import { fmt, MODEL_SHORT, timeStr, TYPE_LABEL } from '../lib/format'
import { useApp } from '../state'

const SEVERITY: Record<Constraint['severity'], string> = {
  critical: 'border-bad/60 text-[#f08a8a]',
  high: 'border-warn/50 text-warn',
  medium: 'border-line-strong text-ink-2',
}

export function Dashboard() {
  const { models, jobs, setTab, setFocusId } = useApp()
  const [verif, setVerif] = useState<Verification | null>(null)
  const [constraints, setConstraints] = useState<Constraint[]>([])
  useEffect(() => {
    api.verification('godel').then(setVerif).catch(() => undefined)
    api.constraints().then(setConstraints).catch(() => undefined)
  }, [])
  const godel = models.find((m) => m.id === 'godel')
  const running = jobs.filter((j) => j.status === 'running' || j.status === 'queued')
  const done = jobs.filter((j) => j.verdict)
  const count = (v: string) => done.filter((j) => j.verdict?.math === v).length
  const open = (j: JobSummary) => {
    setFocusId(j.id)
    setTab('analysis')
  }

  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-12 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="実験総数" value={jobs.length} />
        <Stat label="実行中" value={running.length} tone="accent" />
        <Stat label="数学的に成立（CTC）" value={count('成立')} tone="ctc" />
        <Stat label="不成立" value={count('不成立')} />
        <Stat label="判定不能" value={count('判定不能')} tone="warn" />
      </div>

      <Panel title="研究対象モデル" code="CHRONOS-001" className="col-span-12 xl:col-span-7">
        {godel ? (
          <div className="space-y-4">
            <div>
              <div className="text-base font-semibold text-ink">{godel.name}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{godel.description}</p>
              <div className="num mt-3 overflow-x-auto rounded border border-line bg-bg px-3 py-2 text-[13px] text-accent">
                {godel.metric_text}
              </div>
              <div className="mt-1 text-[11px] text-ink-3">符号 {godel.signature} ・ 座標 (t, r, φ, y) ・ {godel.units}</div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded border border-line bg-panel-2/50 p-3">
                <div className="mb-2 text-[12px] font-semibold text-ink-2">場の方程式の記号検証（SymPy）</div>
                {verif ? (
                  <div className="space-y-1 text-[12.5px]" data-testid="field-eq">
                    <div className="text-ink-3">{verif.ansatz}</div>
                    <div>判定: {verif.solved
                      ? <span className="font-semibold text-good">✓ 残差ゼロ（解として成立）</span>
                      : <span className="text-warn">⚠ 未成立</span>}</div>
                    <div className="num">Λ = <span className="text-accent">{verif.Lambda?.text}</span></div>
                    <div className="num">8πρ = <span className="text-accent">{verif.eight_pi_rho?.text}</span></div>
                    <div className="num text-ink-3">Ricci スカラー R = {verif.ricci_scalar.text}</div>
                  </div>
                ) : <div className="text-[12px] text-ink-3">記号計算中…（初回は数秒かかります）</div>}
              </div>
              <div className="rounded border border-line bg-panel-2/50 p-3">
                <div className="mb-2 text-[12px] font-semibold text-ink-2">照合する既知の解析結果</div>
                <ul className="list-disc space-y-1 pl-4 text-[12px] text-ink-2">
                  {godel.known_results.map((k) => <li key={k}>{k}</li>)}
                </ul>
              </div>
            </div>
            <details className="text-[12px] text-ink-3">
              <summary className="cursor-pointer text-ink-2">出典</summary>
              <ul className="mt-2 space-y-1.5 pl-1">
                {godel.references.map((r) => <li key={r.citation}><span className="text-ink-2">{r.citation}</span> — {r.note}</li>)}
              </ul>
            </details>
          </div>
        ) : <Empty>モデル情報を読み込み中…</Empty>}
      </Panel>

      <Panel title="実験の実行状況" className="col-span-12 xl:col-span-5"
        actions={<Button variant="primary" onClick={() => setTab('control')}>＋ 新しい実験</Button>}>
        {running.length ? (
          <ul className="space-y-2">
            {running.map((j) => (
              <li key={j.id} className="rounded border border-line bg-panel-2/50 p-2.5">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="num text-ink">{j.name}</span>
                  <StatusPill status={j.status} />
                </div>
                <div className="mt-1 text-[11px] text-ink-3">{TYPE_LABEL[j.type]} ・ {j.message}</div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-bg">
                  <div className="h-full bg-accent transition-all" style={{ width: `${(j.progress * 100).toFixed(1)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        ) : <div className="text-[13px] text-ink-3">実行中の実験はありません。</div>}
        <div className="mt-4 mb-2 text-[12px] font-semibold text-ink-2">最新の検証結果</div>
        {done.length ? (
          <ul className="space-y-1.5">
            {done.slice(0, 5).map((j) => (
              <li key={j.id}>
                <button onClick={() => open(j)} className="flex w-full items-center justify-between gap-2 rounded border border-line/70 px-2.5 py-1.5 text-left hover:border-accent/50">
                  <span className="min-w-0">
                    <span className="num mr-2 text-[12px] text-ink-3">{j.name}</span>
                    <span className="truncate text-[13px] text-ink">{j.title}</span>
                  </span>
                  <VerdictBadge math={j.verdict?.math} size="sm" />
                </button>
              </li>
            ))}
          </ul>
        ) : <Empty>まだ実験結果がありません。「実験制御」から実行してください。</Empty>}
      </Panel>

      <Panel title="未解決の物理的制約" className="col-span-12 xl:col-span-5">
        <div className="mb-3 rounded border border-line-strong bg-bg px-3 py-2 text-[12.5px] text-ink-2">
          数学的にCTCが存在することと、物理的にタイムマシンが実現できることは別の問題です。以下は実現を阻む／未解明の論点です。
        </div>
        <ul className="space-y-2" data-testid="constraints">
          {constraints.map((c) => (
            <li key={c.id} className="rounded border border-line bg-panel-2/40 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-ink">{c.title}</span>
                <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10.5px] ${SEVERITY[c.severity]}`}>{c.status}</span>
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{c.detail}</p>
              <div className="mt-1 text-[10.5px] text-ink-3">{c.computed ? '🧮 ' : ''}{c.source}</div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="実験履歴" className="col-span-12 xl:col-span-7">
        {jobs.length ? (
          <div className="scroll-thin max-h-[640px] overflow-auto">
            <table className="w-full text-[12.5px]" data-testid="history-table">
              <thead className="sticky top-0 bg-panel text-left text-[11px] text-ink-3">
                <tr>
                  <th className="px-2 py-1.5 font-medium">ID</th>
                  <th className="px-2 py-1.5 font-medium">実験</th>
                  <th className="px-2 py-1.5 font-medium">モデル</th>
                  <th className="px-2 py-1.5 font-medium">状態</th>
                  <th className="px-2 py-1.5 font-medium">判定</th>
                  <th className="px-2 py-1.5 font-medium">主要値</th>
                  <th className="px-2 py-1.5 font-medium">開始</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const m = j.metrics ? Object.values(j.metrics)[0] : null
                  return (
                    <tr key={j.id} onClick={() => open(j)} className="cursor-pointer border-t border-line/60 hover:bg-panel-2/60">
                      <td className="num px-2 py-1.5 text-ink-3">{j.name}</td>
                      <td className="px-2 py-1.5 text-ink">{j.title ?? TYPE_LABEL[j.type]}</td>
                      <td className="px-2 py-1.5 text-ink-2">{MODEL_SHORT[j.model] ?? j.model}</td>
                      <td className="px-2 py-1.5"><StatusPill status={j.status} /></td>
                      <td className="px-2 py-1.5"><VerdictBadge math={j.verdict?.math} size="sm" /></td>
                      <td className="num px-2 py-1.5 text-[11.5px] text-ink-2">{m ? `${m.label}: ${fmt(m.value, 5)}${m.unit ? ' ' + m.unit : ''}` : j.error ?? '—'}</td>
                      <td className="num px-2 py-1.5 text-[11px] text-ink-3">{timeStr(j.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : <Empty>履歴はまだありません。</Empty>}
      </Panel>
    </div>
  )
}
