import { useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../api/client'
import type { ExperimentResult, ExperimentType, LightCones } from '../api/types'
import { ChartView } from '../components/ChartView'
import { ClassificationBar, EvidenceTable, VerdictPanel } from '../components/ResultDetail'
import { SpacetimeScene, autoTimeScale } from '../components/SpacetimeScene'
import { Button, Empty, Panel, Stat, StatusPill } from '../components/ui'
import { fmt, SERIES, TYPE_LABEL } from '../lib/format'
import { useApp, useJob } from '../state'

type Params = Record<string, number | string | boolean>

interface FieldDef {
  key: string
  label: string
  unit?: string
  kind: 'number' | 'select' | 'checkbox'
  min?: number
  max?: number
  step?: number
  options?: { value: string; label: string }[]
  help?: string
  show?: (p: Params) => boolean
}

const FIELDS: Record<ExperimentType, FieldDef[]> = {
  circle: [
    { key: 'R', label: '円の半径 R', kind: 'number', min: 0.01, max: 10, step: 0.01, help: 'r_c = ln(1+√2) ≈ 0.88137 を境に結果が変わる' },
    { key: 't0', label: '時刻 t₀', kind: 'number', step: 0.1, help: '計量は t に依存しないので結果は不変（確認用）' },
  ],
  geodesic: [
    { key: 'kind', label: '測地線の種類', kind: 'select', options: [{ value: 'null', label: '光的（光）' }, { value: 'timelike', label: '時間的（物体）' }] },
    { key: 'r0', label: '初期半径 r₀', kind: 'number', min: 0.001, max: 8, step: 0.01, help: 'r = 0 は極座標の特異点のため不可' },
    { key: 'speed', label: '初速度 v（静止観測者に対して）', unit: 'c', kind: 'number', min: 0, max: 0.999, step: 0.01, show: (p) => p.kind === 'timelike' },
    { key: 'lock_L0', label: '角運動量 L = 0 に拘束（軸を通る測地線）', kind: 'checkbox', help: '解析解（閉形式）と比較できる' },
    { key: 'psi_deg', label: '発射方位 ψ（0° = 外向き, 90° = +φ）', unit: '°', kind: 'number', min: -180, max: 180, step: 5, show: (p) => !p.lock_L0 },
    { key: 'elev_deg', label: 'y 方向の仰角', unit: '°', kind: 'number', min: -89, max: 89, step: 5 },
    { key: 'lambda_max', label: '積分区間 λ_max', kind: 'number', min: 0.1, max: 200, step: 0.5 },
  ],
  mission: [
    { key: 'R', label: '周回半径 R', kind: 'number', min: 0.05, max: 6, step: 0.01, help: 'R > r_c が必要' },
    { key: 'beta', label: '往復の半径方向速さ β = dr/dt', kind: 'number', min: 0.01, max: 0.99, step: 0.01 },
    { key: 'alpha_mode', label: '後退率 α の指定方法', kind: 'select', options: [{ value: 'fraction', label: 'α_max に対する割合' }, { value: 'absolute', label: '絶対値（上限超過も試せる）' }] },
    { key: 'alpha_frac', label: 'α / α_max', kind: 'number', min: 0.01, max: 0.99, step: 0.01, show: (p) => p.alpha_mode === 'fraction' },
    { key: 'alpha_abs', label: 'α（1 ラジアンあたり遡る座標時間）', kind: 'number', min: 0.001, max: 10, step: 0.01, show: (p) => p.alpha_mode === 'absolute' },
    { key: 'auto_loops', label: '目標年数から周回数を自動決定', kind: 'checkbox' },
    { key: 'target_years', label: '戻りたい年数 T', unit: '年', kind: 'number', min: 0.1, max: 1e6, step: 1, show: (p) => !!p.auto_loops },
    { key: 'loops', label: '周回数 N', kind: 'number', min: 1, max: 20000, step: 1, show: (p) => !p.auto_loops },
  ],
}

const DEFAULTS: Record<ExperimentType, Params> = {
  circle: { R: 1.2, t0: 0 },
  geodesic: { kind: 'null', r0: 0.01, speed: 0.6, lock_L0: true, psi_deg: 0, elev_deg: 0, lambda_max: 6 },
  mission: { R: 1.2, beta: 0.5, alpha_mode: 'fraction', alpha_frac: 0.5, alpha_abs: 0.1, auto_loops: true, target_years: 30, loops: 5 },
}

const PRESETS: Record<ExperimentType, { label: string; params: Params }[]> = {
  circle: [
    { label: 'R = 0.5（内側）', params: { R: 0.5, t0: 0 } },
    { label: 'R = r_c（境界）', params: { R: 0.881373587019543, t0: 0 } },
    { label: 'R = 1.2（外側）', params: { R: 1.2, t0: 0 } },
  ],
  geodesic: [
    { label: '軸からの光（L=0）', params: DEFAULTS.geodesic },
    { label: '物体 v=0.9（L=0）', params: { ...DEFAULTS.geodesic, kind: 'timelike', speed: 0.9, lambda_max: 10 } },
    { label: '外側から斜めに', params: { ...DEFAULTS.geodesic, kind: 'timelike', r0: 1.3, speed: 0.5, lock_L0: false, psi_deg: 60, lambda_max: 20 } },
  ],
  mission: [
    { label: '30年前へ', params: DEFAULTS.mission },
    { label: 'R < r_c（不可能）', params: { ...DEFAULTS.mission, R: 0.7 } },
    { label: 'α 超過（空間的）', params: { ...DEFAULTS.mission, alpha_mode: 'absolute', alpha_abs: 0.8, auto_loops: false, loops: 3 } },
  ],
}

function Field({ def, value, onChange }: { def: FieldDef; value: Params[string]; onChange: (v: Params[string]) => void }) {
  const id = `f-${def.key}`
  if (def.kind === 'checkbox') {
    return (
      <label className="flex items-start gap-2 text-[13px] text-ink-2" htmlFor={id}>
        <input id={id} type="checkbox" className="mt-1" checked={!!value} onChange={(e) => onChange(e.target.checked)} data-testid={id} />
        <span>{def.label}{def.help && <span className="block text-[11px] text-ink-3">{def.help}</span>}</span>
      </label>
    )
  }
  return (
    <label className="block" htmlFor={id}>
      <span className="text-[12px] text-ink-3">{def.label}{def.unit && `（${def.unit}）`}</span>
      {def.kind === 'select' ? (
        <select id={id} value={String(value)} onChange={(e) => onChange(e.target.value)} data-testid={id}
          className="mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-[13px] text-ink">
          {def.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input id={id} type="number" value={value as number} min={def.min} max={def.max} step={def.step ?? 'any'} data-testid={id}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          className="num mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-[13px] text-ink" />
      )}
      {def.help && <span className="mt-0.5 block text-[11px] text-ink-3">{def.help}</span>}
    </label>
  )
}

function MetricCompare({ cur, prev }: { cur: ExperimentResult; prev: ExperimentResult | null }) {
  const keys = Object.keys(cur.metrics)
  return (
    <table className="num w-full text-[12px]" data-testid="metric-compare">
      <thead className="text-left font-sans text-[11px] text-ink-3">
        <tr><th className="py-1 font-medium">指標</th><th className="py-1 text-right font-medium">前回</th><th className="py-1 text-right font-medium">今回</th><th className="py-1 text-right font-medium">差</th></tr>
      </thead>
      <tbody>
        {keys.map((k) => {
          const m = cur.metrics[k]
          const p = prev && prev.type === cur.type ? prev.metrics[k] : undefined
          const d = p && p.value !== null && m.value !== null ? m.value - p.value : null
          return (
            <tr key={k} className="border-t border-line/60">
              <td className="py-1 font-sans text-ink-2">{m.label}{m.unit && <span className="text-ink-3"> [{m.unit}]</span>}</td>
              <td className="py-1 text-right text-ink-3">{fmt(p?.value)}</td>
              <td className="py-1 text-right text-ink">{fmt(m.value)}</td>
              <td className={`py-1 text-right ${d ? 'text-accent' : 'text-ink-3'}`}>{d === null ? '—' : (d > 0 ? '+' : '') + fmt(d, 4)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export function ExperimentControl() {
  const { models, modelId, setModelId, scale, setScale, refreshJobs, setTab, setFocusId, toggleCompare, compareIds } = useApp()
  const model = models.find((m) => m.id === modelId)
  const [type, setType] = useState<ExperimentType>('circle')
  const [paramsByType, setParamsByType] = useState<Record<ExperimentType, Params>>(DEFAULTS)
  const params = paramsByType[type]
  const [auto, setAuto] = useState(true)
  const [preview, setPreview] = useState<ExperimentResult | null>(null)
  const [prevPreview, setPrevPreview] = useState<ExperimentResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [computing, setComputing] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [display, setDisplay] = useState<'preview' | 'job'>('preview')
  const job = useJob(activeId)
  const reqSeq = useRef(0)
  const previewRef = useRef<ExperimentResult | null>(null)
  const fullParams = useMemo(() => ({ ...params, [model?.params[0].key ?? 'a']: scale }), [params, model, scale])

  const setParam = (k: string, v: Params[string]) => setParamsByType((s) => ({ ...s, [type]: { ...s[type], [k]: v } }))

  const runPreview = async () => {
    const seq = ++reqSeq.current
    setComputing(true)
    try {
      const res = await api.preview({ type, model: modelId, params: fullParams })
      if (seq !== reqSeq.current) return
      if (previewRef.current) setPrevPreview(previewRef.current)
      previewRef.current = res.result
      setPreview(res.result)
      setError(null)
      setDisplay('preview')
    } catch (e) {
      if (seq === reqSeq.current) setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      if (seq === reqSeq.current) setComputing(false)
    }
  }

  // パラメータ変更 → デバウンス後に自動再計算（履歴には保存しないプレビュー）
  useEffect(() => {
    if (!auto) return
    const t = window.setTimeout(runPreview, 450)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, type, modelId, JSON.stringify(fullParams)])

  const start = async () => {
    try {
      const j = await api.start({ type, model: modelId, params: fullParams })
      setActiveId(j.id)
      setDisplay('job')
      setError(null)
      void refreshJobs()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    }
  }
  const stop = async () => {
    if (activeId) {
      await api.stop(activeId)
      void refreshJobs()
    }
  }
  const running = job && (job.status === 'running' || job.status === 'queued')
  const shown: ExperimentResult | null = display === 'job' ? job?.result ?? null : preview
  const scenePaths = shown ? [{ id: 'cur', name: '', segments: shown.path.segments, color: SERIES[0], isCtc: shown.is_ctc }] : []
  const [cones, setCones] = useState<LightCones | null>(null)
  useEffect(() => {
    api.lightcones(modelId, scale, 2.4, 5, 6).then(setCones).catch(() => setCones(null))
  }, [modelId, scale])

  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-12 space-y-4 xl:col-span-3">
        <Panel title="実験条件" code="CHRONOS-001">
          <div className="space-y-3.5">
            <div>
              <div className="mb-1 text-[12px] text-ink-3">時空モデル</div>
              <div className="flex gap-1 rounded border border-line bg-bg p-1">
                {models.map((m) => (
                  <button key={m.id} onClick={() => setModelId(m.id)} data-testid={`ctl-model-${m.id}`}
                    className={`flex-1 rounded px-2 py-1.5 text-[12px] ${m.id === modelId ? 'bg-accent/20 text-accent' : 'text-ink-2 hover:text-ink'}`}>{m.name}</button>
                ))}
              </div>
            </div>
            {model && (
              <label className="block">
                <span className="text-[12px] text-ink-3">{model.params[0].label}（{model.params[0].unit}）</span>
                <input type="number" value={scale} min={model.params[0].min} step="any" data-testid="f-scale"
                  onChange={(e) => { const v = Number(e.target.value); if (v > 0) setScale(v) }}
                  className="num mt-1 w-full rounded border border-line bg-bg px-2 py-1.5 text-[13px] text-ink" />
                <span className="mt-0.5 block text-[11px] text-ink-3">{model.params[0].description}</span>
              </label>
            )}
            <div>
              <div className="mb-1 text-[12px] text-ink-3">実験タイプ</div>
              <div className="grid grid-cols-1 gap-1">
                {(Object.keys(FIELDS) as ExperimentType[]).map((t) => (
                  <button key={t} onClick={() => setType(t)} data-testid={`type-${t}`}
                    className={`rounded border px-2.5 py-1.5 text-left text-[13px] ${t === type ? 'border-accent/70 bg-accent/10 text-accent' : 'border-line text-ink-2 hover:border-line-strong'}`}>
                    {TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1 text-[12px] text-ink-3">プリセット</div>
              <div className="flex flex-wrap gap-1">
                {PRESETS[type].map((p) => (
                  <button key={p.label} onClick={() => setParamsByType((s) => ({ ...s, [type]: p.params }))}
                    className="rounded border border-line px-2 py-1 text-[11.5px] text-ink-2 hover:border-accent/50 hover:text-ink">{p.label}</button>
                ))}
              </div>
            </div>
            <div className="space-y-3 border-t border-line pt-3">
              <div className="text-[12px] font-semibold text-ink-2">パラメータ・初期条件</div>
              {FIELDS[type].filter((f) => !f.show || f.show(params)).map((f) => (
                <Field key={f.key} def={f} value={params[f.key]} onChange={(v) => setParam(f.key, v)} />
              ))}
            </div>
          </div>
        </Panel>
      </div>

      <div className="col-span-12 space-y-4 xl:col-span-9">
        <Panel title="実行コントロール">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={start} disabled={!!running} testId="btn-start">▶ 実験開始（履歴に保存）</Button>
            <Button variant="danger" onClick={stop} disabled={!running} testId="btn-stop">■ 停止</Button>
            <Button onClick={runPreview} testId="btn-preview">↻ 再計算</Button>
            <label className="ml-1 flex items-center gap-2 text-[13px] text-ink-2">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} data-testid="auto-recompute" />
              パラメータ変更時に自動再計算
            </label>
            <span className="ml-auto flex items-center gap-3 text-[12px] text-ink-3">
              {computing && <span className="text-accent lamp-pulse">計算中…</span>}
              {job && (
                <span className="flex items-center gap-2">
                  <span className="num">{job.name}</span>
                  <StatusPill status={job.status} />
                </span>
              )}
            </span>
          </div>
          {job && running && (
            <div className="mt-3">
              <div className="flex justify-between text-[11.5px] text-ink-3"><span>{job.message}</span><span className="num">{(job.progress * 100).toFixed(0)}%</span></div>
              <div className="mt-1 h-1.5 overflow-hidden rounded bg-bg"><div className="h-full bg-accent transition-all" style={{ width: `${job.progress * 100}%` }} /></div>
            </div>
          )}
          {job?.error && <div className="mt-3 rounded border border-bad/50 bg-bad/10 px-3 py-2 text-[13px] text-[#f08a8a]">{job.error}</div>}
          {error && <div className="mt-3 rounded border border-bad/50 bg-bad/10 px-3 py-2 text-[13px] text-[#f08a8a]" data-testid="input-error">入力エラー: {error}</div>}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
            表示中:
            <button onClick={() => setDisplay('preview')} className={display === 'preview' ? 'text-accent' : 'hover:text-ink'}>プレビュー（自動再計算）</button>
            {job && <>/<button onClick={() => setDisplay('job')} className={display === 'job' ? 'text-accent' : 'hover:text-ink'}>{job.name}</button></>}
            {job?.result && (
              <span className="ml-auto flex gap-2">
                <Button variant="ghost" onClick={() => toggleCompare(job.id)}>{compareIds.includes(job.id) ? '✓ 比較対象' : '＋ 比較に追加'}</Button>
                <Button onClick={() => { setFocusId(job.id); setTab('analysis') }} testId="btn-open-analysis">結果解析で開く →</Button>
              </span>
            )}
          </div>
        </Panel>

        {shown ? (
          <div className="grid grid-cols-12 gap-4" data-testid="control-result">
            <div className="col-span-12 space-y-4 2xl:col-span-7">
              <VerdictPanel result={shown} />
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                {Object.entries(shown.metrics).slice(0, 4).map(([k, m]) => <Stat key={k} label={m.label} value={fmt(m.value, 5)} unit={m.unit} />)}
              </div>
              <Panel title="計算根拠"><ClassificationBar result={shown} /><div className="mt-3"><EvidenceTable result={shown} /></div></Panel>
            </div>
            <div className="col-span-12 space-y-4 2xl:col-span-5">
              <Panel title="経路（3D 座標図）">
                <div className="h-[320px] overflow-hidden rounded border border-line">
                  {cones && <SpacetimeScene cones={cones.cones} criticalRadius={cones.critical_radius} paths={scenePaths}
                    timeScale={autoTimeScale(scenePaths)} showCones showCritical rMax={2.4} />}
                </div>
              </Panel>
              {shown.charts[0] && <ChartView sources={[{ name: '', spec: shown.charts[0] }]} />}
              <Panel title="パラメータ変更による比較（前回プレビュー vs 今回）">
                <MetricCompare cur={shown} prev={display === 'preview' ? prevPreview : preview} />
              </Panel>
            </div>
          </div>
        ) : <Empty>パラメータを設定すると自動で計算結果が表示されます。</Empty>}
      </div>
    </div>
  )
}
