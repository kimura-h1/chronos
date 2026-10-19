import type { ExperimentType, JobStatus } from '../api/types'

export function fmt(v: unknown, digits = 6): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? 'はい' : 'いいえ'
  if (typeof v !== 'number') return String(v)
  if (!Number.isFinite(v)) return '—'
  if (v === 0) return '0'
  const a = Math.abs(v)
  if (a >= 1e6 || a < 1e-3) return v.toExponential(Math.max(1, digits - 3))
  return Number(v.toPrecision(digits)).toString()
}

export const TYPE_LABEL: Record<ExperimentType, string> = {
  circle: '円軌道CTC検証',
  geodesic: '測地線積分',
  mission: '過去到達ミッション',
}

export const STATUS_LABEL: Record<JobStatus, string> = {
  queued: '待機',
  running: '実行中',
  completed: '完了',
  stopped: '停止',
  failed: '失敗',
}

export const MODEL_SHORT: Record<string, string> = { godel: 'Gödel', minkowski: 'Minkowski' }

/** 比較・重ね描きに使う系列色（ダーク面で CVD 検証済みの 3 色。3 系列まで） */
export const SERIES = ['#3987e5', '#d95926', '#199e70'] as const

export function timeStr(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString('ja-JP', { hour12: false })
}
