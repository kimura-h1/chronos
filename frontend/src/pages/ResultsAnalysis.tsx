import { api } from '../api/client'
import type { Job } from '../api/types'
import { ChartView } from '../components/ChartView'
import { ClassificationBar, ComparisonTable, ErrorList, EvidenceTable, Notes, ResultCharts, VerdictPanel } from '../components/ResultDetail'
import { Empty, Panel, StatusPill, VerdictBadge } from '../components/ui'
import { fmt, MODEL_SHORT, SERIES, timeStr, TYPE_LABEL } from '../lib/format'
import { MAX_COMPARE, useApp, useJob } from '../state'

function ParamsTable({ params }: { params: Record<string, unknown> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Object.entries(params).map(([k, v]) => (
        <span key={k} className="num rounded border border-line bg-bg px-2 py-0.5 text-[11.5px] text-ink-2">
          {k} = <span className="text-ink">{typeof v === 'number' ? fmt(v, 8) : String(v)}</span>
        </span>
      ))}
    </div>
  )
}

function Comparison({ ids }: { ids: string[] }) {
  const a = useJob(ids[0] ?? null)
  const b = useJob(ids[1] ?? null)
  const c = useJob(ids[2] ?? null)
  const jobs = [a, b, c].filter((j): j is Job => !!j?.result)
  if (jobs.length < 2) return <Empty>比較するには左の一覧で 2〜{MAX_COMPARE} 件の「比較」にチェックを入れてください。</Empty>
  const keys = Array.from(new Set(jobs.flatMap((j) => Object.keys(j.result!.metrics))))
  const sameType = jobs.every((j) => j.type === jobs[0].type)
  const chartIds = sameType ? jobs[0].result!.charts.map((ch) => ch.id) : []
  return (
    <div className="space-y-4" data-testid="comparison">
      <div className="overflow-x-auto rounded border border-line">
        <table className="w-full text-[12.5px]">
          <thead className="bg-panel-2 text-left text-[11px] text-ink-3">
            <tr>
              <th className="px-3 py-1.5 font-medium">項目</th>
              {jobs.map((j, i) => (
                <th key={j.id} className="px-3 py-1.5 text-right font-medium">
                  <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: SERIES[i] }} />
                  <span className="num text-ink">{j.name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-line/70"><td className="px-3 py-1.5 text-ink-2">実験</td>{jobs.map((j) => <td key={j.id} className="px-3 py-1.5 text-right text-ink">{j.result!.title}</td>)}</tr>
            <tr className="border-t border-line/70"><td className="px-3 py-1.5 text-ink-2">モデル</td>{jobs.map((j) => <td key={j.id} className="px-3 py-1.5 text-right">{MODEL_SHORT[j.model]}</td>)}</tr>
            <tr className="border-t border-line/70"><td className="px-3 py-1.5 text-ink-2">判定</td>{jobs.map((j) => <td key={j.id} className="px-3 py-1.5 text-right"><VerdictBadge math={j.result!.verdict.math} size="sm" /></td>)}</tr>
            {keys.map((k) => {
              const ref = jobs.find((j) => j.result!.metrics[k])!.result!.metrics[k]
              return (
                <tr key={k} className="border-t border-line/70">
                  <td className="px-3 py-1.5 text-ink-2">{ref.label}{ref.unit && <span className="text-ink-3"> [{ref.unit}]</span>}</td>
                  {jobs.map((j) => <td key={j.id} className="num px-3 py-1.5 text-right text-ink">{fmt(j.result!.metrics[k]?.value)}</td>)}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {sameType ? (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {chartIds.map((cid) => (
            <ChartView key={cid} sources={jobs.flatMap((j) => {
              const spec = j.result!.charts.find((ch) => ch.id === cid)
              return spec ? [{ name: j.name, spec }] : []
            })} />
          ))}
        </div>
      ) : <div className="text-[12px] text-ink-3">実験タイプが異なるため、グラフの重ね合わせは同じタイプ同士でのみ表示します（数値表は上記）。</div>}
    </div>
  )
}

export function ResultsAnalysis() {
  const { jobs, focusId, setFocusId, compareIds, toggleCompare, refreshJobs } = useApp()
  const job = useJob(focusId)
  const result = job?.result

  const remove = async (id: string) => {
    if (!window.confirm('この実験結果を削除しますか？（元に戻せません）')) return
    await api.remove(id)
    if (compareIds.includes(id)) toggleCompare(id)
    if (focusId === id) setFocusId(null)
    void refreshJobs()
  }

  return (
    <div className="grid grid-cols-12 gap-4">
      <Panel title="実験一覧" className="col-span-12 xl:col-span-3">
        {jobs.length ? (
          <ul className="scroll-thin max-h-[calc(100vh-200px)] space-y-1.5 overflow-auto pr-1" data-testid="analysis-list">
            {jobs.map((j) => (
              <li key={j.id}
                className={`rounded border px-2.5 py-2 ${j.id === focusId ? 'border-accent/70 bg-accent/5' : 'border-line hover:border-line-strong'}`}>
                <button className="w-full text-left" onClick={() => setFocusId(j.id)}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="num text-[11.5px] text-ink-3">{j.name}</span>
                    <StatusPill status={j.status} />
                  </div>
                  <div className="mt-0.5 truncate text-[13px] text-ink">{j.title ?? TYPE_LABEL[j.type]}</div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-[11px] text-ink-3">{MODEL_SHORT[j.model]} ・ {TYPE_LABEL[j.type]}</span>
                    <VerdictBadge math={j.verdict?.math} size="sm" />
                  </div>
                </button>
                <div className="mt-1.5 flex items-center justify-between text-[11.5px]">
                  <label className="flex items-center gap-1.5 text-ink-2">
                    <input type="checkbox" checked={compareIds.includes(j.id)} disabled={!j.verdict} onChange={() => toggleCompare(j.id)} data-testid={`compare-${j.name}`} />
                    比較
                    {compareIds.includes(j.id) && <span className="h-2 w-2 rounded-sm" style={{ background: SERIES[compareIds.indexOf(j.id)] }} />}
                  </label>
                  <button className="text-ink-3 hover:text-[#f08a8a]" onClick={() => remove(j.id)}>削除</button>
                </div>
              </li>
            ))}
          </ul>
        ) : <Empty>実験結果がありません。</Empty>}
      </Panel>

      <div className="col-span-12 space-y-4 xl:col-span-9">
        {job ? (
          <>
            <Panel title={job.result?.title ?? TYPE_LABEL[job.type]} code={job.name}
              actions={
                <a href={api.downloadUrl(job.id)} download={`${job.name}.json`} data-testid="download-json"
                  className="inline-flex items-center gap-1.5 rounded border border-accent/70 bg-accent/15 px-3 py-1.5 text-[13px] font-medium text-accent hover:bg-accent/25">
                  ⤓ JSON ダウンロード
                </a>
              }>
              <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3">
                <span>{TYPE_LABEL[job.type]}</span><span>{MODEL_SHORT[job.model]}</span>
                <StatusPill status={job.status} /><span>開始 {timeStr(job.created_at)}</span><span>終了 {timeStr(job.finished_at)}</span>
              </div>
              <ParamsTable params={result?.params ?? job.params} />
              {job.error && <div className="mt-3 rounded border border-bad/50 bg-bad/10 px-3 py-2 text-[13px] text-[#f08a8a]">{job.error}</div>}
              {result && <div className="mt-4"><VerdictPanel result={result} /></div>}
            </Panel>
            {result && (
              <>
                <div className="grid grid-cols-12 gap-4">
                  <Panel title="計量による経路分類と判定根拠" className="col-span-12 2xl:col-span-7">
                    <ClassificationBar result={result} />
                    <div className="mt-3"><EvidenceTable result={result} /></div>
                  </Panel>
                  <div className="col-span-12 space-y-4 2xl:col-span-5">
                    <Panel title="解析解との比較"><ComparisonTable result={result} /></Panel>
                    <Panel title="数値誤差"><ErrorList result={result} /></Panel>
                  </div>
                </div>
                <Panel title="経路グラフ"><ResultCharts result={result} name={job.name} /></Panel>
                <Panel title="注意事項・限界"><Notes result={result} /></Panel>
              </>
            )}
          </>
        ) : <Empty>左の一覧から実験を選択してください。</Empty>}
        <Panel title={`実験結果の比較（${compareIds.length}/${MAX_COMPARE}）`}>
          <Comparison ids={compareIds} />
        </Panel>
      </div>
    </div>
  )
}
