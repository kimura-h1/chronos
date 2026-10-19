import { useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ChartSpec } from '../api/types'
import { fmt, SERIES } from '../lib/format'

export interface ChartSeriesSource {
  name: string // 実験名（重ね描き時）
  spec: ChartSpec
}

const AXIS = { stroke: '#33465c', tick: { fill: '#8a99aa', fontSize: 11 }, tickLine: false }
const DASH = ['', '6 4', '2 3']

/** バックエンドが返す ChartSpec を描画。複数ソースを渡すと同一チャートIDを重ね描きして比較する（最大 3）。 */
export function ChartView({ sources, height = 230 }: { sources: ChartSeriesSource[]; height?: number }) {
  const [table, setTable] = useState(false)
  if (!sources.length) return null
  const base = sources[0].spec
  const overlay = sources.length > 1
  const series = sources.flatMap((src, si) =>
    src.spec.lines.map((ln, li) => ({
      key: `${si}-${ln.key}`,
      dataKey: ln.key,
      data: src.spec.data,
      name: overlay ? `${src.name}: ${ln.label}` : ln.label,
      color: SERIES[(overlay ? si : li) % SERIES.length],
      dash: overlay ? DASH[li % DASH.length] : '',
    })),
  )
  const log = base.yScale === 'log'
  return (
    <figure className="rounded border border-line bg-bg/60 p-3" data-testid={`chart-${base.id}`}>
      <figcaption className="mb-2 flex items-start justify-between gap-2">
        <span className="text-[13px] font-medium text-ink">{base.title}</span>
        <button className="shrink-0 text-[11px] text-ink-3 hover:text-accent" onClick={() => setTable((t) => !t)}>
          {table ? 'グラフ表示' : '表で見る'}
        </button>
      </figcaption>
      {table ? (
        <div className="scroll-thin max-h-[240px] overflow-auto">
          <table className="num w-full text-[11px]">
            <thead className="sticky top-0 bg-panel text-ink-3">
              <tr>
                <th className="px-2 py-1 text-left">{base.x.label}</th>
                {base.lines.map((l) => <th key={l.key} className="px-2 py-1 text-right">{overlay ? `${sources[0].name}: ` : ''}{l.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {base.data.filter((_, i) => i % Math.max(1, Math.floor(base.data.length / 60)) === 0).map((row, i) => (
                <tr key={i} className="border-t border-line/50 text-ink-2">
                  <td className="px-2 py-0.5">{fmt(row[base.x.key])}</td>
                  {base.lines.map((l) => <td key={l.key} className="px-2 py-0.5 text-right">{fmt(row[l.key])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <LineChart margin={{ top: 8, right: 16, bottom: 18, left: 6 }}>
            <CartesianGrid stroke="#1b2633" strokeDasharray="0" />
            <XAxis
              {...AXIS}
              type="number"
              dataKey={base.x.key}
              domain={['dataMin', 'dataMax']}
              tickFormatter={(v) => fmt(v, 3)}
              allowDuplicatedCategory={false}
              label={{ value: base.x.label, position: 'insideBottom', offset: -10, fill: '#6f7f91', fontSize: 11 }}
            />
            <YAxis
              {...AXIS}
              width={62}
              scale={log ? 'log' : 'auto'}
              domain={log ? ['auto', 'auto'] : ['auto', 'auto']}
              allowDataOverflow={false}
              tickFormatter={(v) => fmt(v, 3)}
            />
            <Tooltip
              contentStyle={{ background: '#0f151d', border: '1px solid #33465c', borderRadius: 4, fontSize: 12 }}
              labelStyle={{ color: '#a9b6c4' }}
              itemStyle={{ color: '#e6edf3' }}
              labelFormatter={(v) => `${base.x.label}: ${fmt(v)}`}
              formatter={(v) => fmt(v as number)}
              cursor={{ stroke: '#5fd4e8', strokeOpacity: 0.4 }}
            />
            {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: '#a9b6c4', paddingTop: 6 }} verticalAlign="top" height={24} />}
            {base.refs.map((r, i) =>
              r.axis === 'x' ? (
                <ReferenceLine key={i} x={r.value} stroke="#6f7f91" strokeDasharray="4 3"
                  label={{ value: r.label, position: 'insideTopRight', fill: '#a9b6c4', fontSize: 10 }} />
              ) : (
                <ReferenceLine key={i} y={r.value} stroke="#6f7f91" strokeDasharray="4 3"
                  label={{ value: r.label, position: 'insideBottomRight', fill: '#a9b6c4', fontSize: 10 }} />
              ),
            )}
            {series.map((s) => (
              <Line key={s.key} data={s.data} dataKey={s.dataKey} name={s.name} stroke={s.color} strokeWidth={2}
                strokeDasharray={s.dash} dot={false} isAnimationActive={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </figure>
  )
}
