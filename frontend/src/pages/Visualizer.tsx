import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import type { ChartSpec, LightCones, Profile } from '../api/types'
import { ChartView } from '../components/ChartView'
import { autoTimeScale, SpacetimeScene, type ScenePath } from '../components/SpacetimeScene'
import { Empty, Panel, VerdictBadge } from '../components/ui'
import { fmt, SERIES, TYPE_LABEL } from '../lib/format'
import { useApp, useJob } from '../state'

function ModelSwitch() {
  const { models, modelId, setModelId } = useApp()
  return (
    <div className="flex gap-1 rounded border border-line bg-bg p-1" role="tablist" aria-label="時空モデル">
      {models.map((m) => (
        <button key={m.id} role="tab" aria-selected={m.id === modelId} data-testid={`model-${m.id}`}
          onClick={() => setModelId(m.id)}
          className={`flex-1 rounded px-2 py-1.5 text-[12.5px] ${m.id === modelId ? 'bg-accent/20 text-accent' : 'text-ink-2 hover:text-ink'}`}>
          {m.name}
        </button>
      ))}
    </div>
  )
}

function useScenePath(id: string | null, color: string): ScenePath | null {
  const job = useJob(id)
  if (!job?.result) return null
  return { id: job.id, name: job.name, segments: job.result.path.segments, color, isCtc: job.result.is_ctc }
}

export function Visualizer() {
  const { models, modelId, scale, setScale, jobs, focusId } = useApp()
  const model = models.find((m) => m.id === modelId)
  const [cones, setCones] = useState<LightCones | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [showCones, setShowCones] = useState(true)
  const [showCritical, setShowCritical] = useState(true)
  const [autoTs, setAutoTs] = useState(true)
  const [manualTs, setManualTs] = useState(1)
  const rMax = 2.4

  const candidates = jobs.filter((j) => j.model === modelId && j.status !== 'failed' && j.verdict)
  const [shown, setShown] = useState<string[]>([])
  useEffect(() => {
    // 既定: 結果解析でフォーカス中の実験（同じモデルなら）を表示
    setShown((s) => (s.length ? s.filter((id) => candidates.some((c) => c.id === id)) :
      focusId && candidates.some((c) => c.id === focusId) ? [focusId] : candidates.slice(0, 1).map((c) => c.id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, candidates.length])

  useEffect(() => {
    api.lightcones(modelId, scale, rMax, 6, 6).then(setCones).catch(() => setCones(null))
    api.profile(modelId, scale, 2.2).then(setProfile).catch(() => setProfile(null))
  }, [modelId, scale])

  const p0 = useScenePath(shown[0] ?? null, SERIES[0])
  const p1 = useScenePath(shown[1] ?? null, SERIES[1])
  const p2 = useScenePath(shown[2] ?? null, SERIES[2])
  const paths = useMemo(() => [p0, p1, p2].filter((p): p is ScenePath => !!p), [p0, p1, p2])
  const ts = autoTs ? autoTimeScale(paths) : manualTs
  const rc = cones?.critical_radius ?? null

  const charts: ChartSpec[] = useMemo(() => {
    if (!profile) return []
    const refs = rc !== null ? [{ axis: 'x' as const, value: rc, label: 'r_c' }] : []
    const s2 = scale * scale
    return [
      {
        id: 'metric', title: '計量成分 g_μν(r) / スケール²', x: { key: 'r', label: 'r' },
        lines: [{ key: 'g_phiphi', label: 'g_φφ' }, { key: 'g_tphi', label: 'g_tφ' }, { key: 'g_tt', label: 'g_tt' }],
        data: profile.rows.map((r) => ({ r: r.r, g_phiphi: r.g_phiphi / s2, g_tphi: r.g_tphi / s2, g_tt: r.g_tt / s2 })),
        refs: [{ axis: 'y', value: 0, label: '0' }, ...refs],
      },
      {
        id: 'tilt', title: '光円錐の傾き指標（負 = 未来の光が t 減少方向を含む）', x: { key: 'r', label: 'r' },
        lines: [{ key: 'cone_tilt', label: 'min k^t / k^t_radial' }], data: profile.rows.map((r) => ({ r: r.r, cone_tilt: r.cone_tilt })),
        refs: [{ axis: 'y', value: 0, label: '水平' }, ...refs],
      },
      {
        id: 'amax', title: '周回で遡れる最大後退率 α_max(r)', x: { key: 'r', label: 'r' },
        lines: [{ key: 'alpha_max', label: 'α_max' }], data: profile.rows.map((r) => ({ r: r.r, alpha_max: r.alpha_max })),
        refs,
      },
    ]
  }, [profile, rc, scale])

  const toggle = (id: string) =>
    setShown((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-3)))

  return (
    <div className="grid grid-cols-12 gap-4">
      <Panel title="時空ビジュアライザ" code={model?.name} className="col-span-12 xl:col-span-9">
        <div className="relative h-[620px] overflow-hidden rounded border border-line" data-testid="visualizer-3d">
          {cones ? (
            <SpacetimeScene cones={cones.cones} criticalRadius={rc} paths={paths} timeScale={ts}
              showCones={showCones} showCritical={showCritical} rMax={rMax} />
          ) : <Empty>光円錐データを読み込み中…</Empty>}
          <div className="pointer-events-none absolute top-3 left-3 max-w-[300px] rounded border border-line bg-panel/90 p-3 text-[11.5px] text-ink-2">
            <div className="mb-1.5 font-semibold text-ink">凡例</div>
            <ul className="space-y-1">
              <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-[#5fd4e8]/60" />未来光円錐（r &lt; r_c、通常の向き）</li>
              <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-warn/70" />傾いた光円錐（t 減少方向を含む）</li>
              {rc !== null && <li className="flex items-center gap-2"><span className="h-0 w-3 border-t border-dashed border-warn" />臨界面 r = r_c = {fmt(rc, 7)}</li>}
              <li className="flex items-center gap-2"><span className="h-1 w-3 rounded bg-[#ff5fa2]" />閉じた時間的曲線（CTC 判定: 成立）</li>
              <li className="flex items-center gap-2"><span className="h-0 w-3 border-t-2 border-dashed border-bad" />空間的区間</li>
              <li className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-white" />経路の始点</li>
            </ul>
          </div>
          <div className="pointer-events-none absolute right-3 bottom-3 max-w-[380px] rounded border border-line bg-panel/90 p-2.5 text-[11px] leading-relaxed text-ink-3">
            座標図: X = r cosφ, Z = r sinφ, 上方向 = t（y は省略）。r, t は無次元座標、物理換算は 時間 = √(−g_tt) t（{model?.params[0]?.label} = {scale} {model?.params[0]?.unit} のとき t の 1 単位 = {profile ? fmt(Math.sqrt(-profile.rows[0].g_tt)) : '—'} 年）。
            縦方向の表示倍率 ×{fmt(ts, 3)}。距離は計量的に正しくありません。光円錐の<b className="text-ink-2">向き</b>は計量から厳密に計算し、大きさのみ表示用に正規化しています。
            <div className="mt-1 text-ink-2">ドラッグで回転・ホイールでズーム・右ドラッグで平行移動</div>
          </div>
        </div>
      </Panel>

      <div className="col-span-12 space-y-4 xl:col-span-3">
        <Panel title="表示設定">
          <div className="space-y-3 text-[13px]">
            <ModelSwitch />
            {model && (
              <label className="block">
                <span className="text-[12px] text-ink-3">{model.params[0].label}（{model.params[0].unit}）</span>
                <input type="number" min={model.params[0].min} step="any" value={scale}
                  onChange={(e) => { const v = Number(e.target.value); if (v > 0) setScale(v) }}
                  className="num mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-ink" />
              </label>
            )}
            <label className="flex items-center gap-2"><input type="checkbox" checked={showCones} onChange={(e) => setShowCones(e.target.checked)} />光円錐を表示</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={showCritical} onChange={(e) => setShowCritical(e.target.checked)} />臨界面 r = r_c を表示</label>
            <div>
              <label className="flex items-center gap-2"><input type="checkbox" checked={autoTs} onChange={(e) => setAutoTs(e.target.checked)} />縦（t）倍率を自動調整</label>
              {!autoTs && (
                <input type="range" min={0.02} max={2} step={0.01} value={manualTs} onChange={(e) => setManualTs(Number(e.target.value))} className="mt-2 w-full" />
              )}
            </div>
          </div>
        </Panel>
        <Panel title="重ねる実験経路（最大 3）">
          {candidates.length ? (
            <ul className="scroll-thin max-h-[300px] space-y-1 overflow-auto">
              {candidates.map((j) => {
                const idx = shown.indexOf(j.id)
                return (
                  <li key={j.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded border border-line/60 px-2 py-1.5 text-[12px] hover:border-accent/50">
                      <input type="checkbox" checked={idx >= 0} onChange={() => toggle(j.id)} />
                      {idx >= 0 && <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES[idx] }} />}
                      <span className="min-w-0 flex-1">
                        <span className="num block text-[11px] text-ink-3">{j.name} ・ {TYPE_LABEL[j.type]}</span>
                        <span className="block truncate text-ink">{j.title}</span>
                      </span>
                      <VerdictBadge math={j.verdict?.math} size="sm" />
                    </label>
                  </li>
                )
              })}
            </ul>
          ) : <Empty>このモデルの実験結果がありません。</Empty>}
        </Panel>
      </div>

      <div className="col-span-12 grid grid-cols-1 gap-3 lg:grid-cols-3">
        {charts.map((c) => <ChartView key={c.id} sources={[{ name: '', spec: c }]} height={220} />)}
      </div>
    </div>
  )
}
