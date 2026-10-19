import type { ExperimentResult } from '../api/types'
import { fmt } from '../lib/format'
import { ChartView } from './ChartView'
import { PhysicalBadge, VerdictBadge } from './ui'

export function VerdictPanel({ result }: { result: ExperimentResult }) {
  const v = result.verdict
  const border = v.math === '成立' ? 'border-ctc/60' : v.math === '判定不能' ? 'border-warn/60' : 'border-line-strong'
  return (
    <div className={`rounded-md border-2 ${border} bg-panel-2/70 p-4`} data-testid="verdict-panel">
      <div className="flex flex-wrap items-center gap-2">
        <VerdictBadge math={v.math} size="lg" />
        <PhysicalBadge value={v.physical} size="lg" />
      </div>
      <div className="mt-3 text-lg font-semibold text-ink" data-testid="verdict-label">{v.label}</div>
      <div className="mt-1 text-[13px] leading-relaxed text-ink-2">
        <span className="mr-1 text-ink-3">判定根拠:</span>
        {v.reason}
      </div>
      <div className="mt-2 text-[11px] text-ink-3">
        「数学的」はこの計量の中での判定です。現実の時間移動の可能性を示すものではありません。
      </div>
    </div>
  )
}

export function EvidenceTable({ result }: { result: ExperimentResult }) {
  return (
    <div className="overflow-hidden rounded border border-line">
      <table className="w-full text-[12.5px]" data-testid="evidence-table">
        <thead className="bg-panel-2 text-left text-[11px] text-ink-3">
          <tr>
            <th className="px-3 py-1.5 font-medium">項目</th>
            <th className="px-3 py-1.5 font-medium">計算式・条件</th>
            <th className="px-3 py-1.5 text-right font-medium">値</th>
          </tr>
        </thead>
        <tbody>
          {result.evidence.map((e, i) => (
            <tr key={i} className="border-t border-line/70 align-top">
              <td className="px-3 py-1.5 text-ink-2">{e.label}</td>
              <td className="num px-3 py-1.5 text-[11.5px] text-ink-3">{e.formula}</td>
              <td className="px-3 py-1.5 text-right">
                <div className="num text-ink">{fmt(e.value, 10)}{e.unit && <span className="ml-1 text-ink-3">{e.unit}</span>}</div>
                {e.detail && <div className="text-[11px] text-ink-3">{e.detail}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ComparisonTable({ result }: { result: ExperimentResult }) {
  if (!result.comparisons.length) return <div className="text-sm text-ink-3">この実験には解析解との比較項目がありません。</div>
  return (
    <div className="overflow-hidden rounded border border-line">
      <table className="num w-full text-[12px]" data-testid="comparison-table">
        <thead className="bg-panel-2 text-left font-sans text-[11px] text-ink-3">
          <tr>
            <th className="px-3 py-1.5 font-medium">比較項目</th>
            <th className="px-3 py-1.5 text-right font-medium">数値解</th>
            <th className="px-3 py-1.5 text-right font-medium">解析解</th>
            <th className="px-3 py-1.5 text-right font-medium">絶対誤差</th>
            <th className="px-3 py-1.5 text-right font-medium">相対誤差</th>
          </tr>
        </thead>
        <tbody>
          {result.comparisons.map((c, i) => (
            <tr key={i} className="border-t border-line/70 align-top">
              <td className="px-3 py-1.5 font-sans text-ink-2">
                {c.label}
                <div className="text-[10.5px] text-ink-3">{c.method}</div>
              </td>
              <td className="px-3 py-1.5 text-right text-ink">{fmt(c.numeric, 15)}</td>
              <td className="px-3 py-1.5 text-right text-ink">
                {fmt(c.analytic, 15)}
                <div className="font-sans text-[10.5px] text-ink-3">{c.analytic_label}</div>
              </td>
              <td className="px-3 py-1.5 text-right text-accent">{fmt(c.abs_error, 3)}</td>
              <td className="px-3 py-1.5 text-right text-ink-2">{fmt(c.rel_error, 3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ErrorList({ result }: { result: ExperimentResult }) {
  return (
    <ul className="space-y-1.5" data-testid="error-list">
      {result.errors.map((e, i) => (
        <li key={i} className="flex items-baseline justify-between gap-3 rounded border border-line/70 bg-bg/40 px-3 py-1.5 text-[12.5px]">
          <span className="text-ink-2">
            {e.label}
            {e.note && <span className="ml-2 text-[11px] text-ink-3">{e.note}</span>}
          </span>
          <span className="num shrink-0 text-accent">{fmt(e.value, 3)}</span>
        </li>
      ))}
    </ul>
  )
}

export function ClassificationBar({ result }: { result: ExperimentResult }) {
  const c = result.classification
  if (!c.total) return null
  const parts = [
    { n: c.timelike - c.past_directed, label: '時間的（未来向き）', color: '#3987e5' },
    { n: c.past_directed, label: '時間的（過去向き）', color: '#d95926' },
    { n: c.boundary, label: '境界（光的／誤差範囲内）', color: '#fab219' },
    { n: c.spacelike, label: '空間的', color: '#d03b3b' },
  ].filter((p) => p.n > 0)
  return (
    <div data-testid="classification">
      <div className="mb-1.5 text-[12.5px] text-ink-2">{c.label}</div>
      <div className="flex h-3 gap-[2px] overflow-hidden rounded">
        {parts.map((p) => <div key={p.label} style={{ flex: p.n, background: p.color }} title={`${p.label}: ${p.n}`} />)}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-2">
        {parts.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
            {p.label} <span className="num text-ink">{p.n}</span>
          </span>
        ))}
        <span className="text-ink-3">（全 {c.total} 点、g(u,u) の符号を誤差上界付きで判定）</span>
      </div>
    </div>
  )
}

export function Notes({ result }: { result: ExperimentResult }) {
  return (
    <div className="space-y-2">
      {result.warnings.map((w, i) => (
        <div key={i} className="rounded border border-warn/40 bg-warn/5 px-3 py-1.5 text-[12.5px] text-warn">⚠ {w}</div>
      ))}
      <ul className="list-disc space-y-1 pl-5 text-[12px] text-ink-3">
        {result.caveats.map((c, i) => <li key={i}>{c}</li>)}
      </ul>
    </div>
  )
}

export function ResultCharts({ result, name }: { result: ExperimentResult; name: string }) {
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      {result.charts.map((c) => <ChartView key={c.id} sources={[{ name, spec: c }]} />)}
    </div>
  )
}
