import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from './api/client'
import type { Job, JobSummary, ModelInfo } from './api/types'

export type Tab = 'dashboard' | 'visualizer' | 'control' | 'analysis'
const TABS: Tab[] = ['dashboard', 'visualizer', 'control', 'analysis']

interface AppState {
  tab: Tab
  setTab: (t: Tab) => void
  online: boolean | null
  models: ModelInfo[]
  modelId: string
  setModelId: (id: string) => void
  scale: number
  setScale: (v: number) => void
  jobs: JobSummary[]
  refreshJobs: () => Promise<void>
  focusId: string | null
  setFocusId: (id: string | null) => void
  compareIds: string[]
  toggleCompare: (id: string) => void
  getJob: (id: string) => Job | undefined
  loadJob: (id: string) => Promise<Job | undefined>
}

const Ctx = createContext<AppState | null>(null)
export const MAX_COMPARE = 3

function tabFromHash(): Tab {
  const h = window.location.hash.replace('#/', '').replace('#', '') as Tab
  return TABS.includes(h) ? h : 'dashboard'
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [tab, setTabState] = useState<Tab>(tabFromHash)
  const [online, setOnline] = useState<boolean | null>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [modelId, setModelId] = useState('godel')
  const [scales, setScales] = useState<Record<string, number>>({})
  const [jobs, setJobs] = useState<JobSummary[]>([])
  const [focusId, setFocusId] = useState<string | null>(null)
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [jobCache, setJobCache] = useState<Record<string, Job>>({})
  const cacheRef = useRef(jobCache)
  cacheRef.current = jobCache

  const setTab = useCallback((t: Tab) => {
    window.location.hash = `#/${t}`
    setTabState(t)
  }, [])
  useEffect(() => {
    const onHash = () => setTabState(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    api.models().then(setModels).catch(() => setOnline(false))
  }, [])

  const loadJob = useCallback(async (id: string) => {
    try {
      const job = await api.experiment(id)
      setJobCache((c) => ({ ...c, [id]: job }))
      return job
    } catch {
      return undefined
    }
  }, [])

  const refreshJobs = useCallback(async () => {
    try {
      const list = await api.experiments()
      setOnline(true)
      setJobs(list)
      // 終了状態が変わったジョブは詳細を再取得
      for (const s of list) {
        const cached = cacheRef.current[s.id]
        if (cached && (cached.status !== s.status || (s.status === 'running' && cached.progress !== s.progress))) {
          void loadJob(s.id)
        }
      }
    } catch {
      setOnline(false)
    }
  }, [loadJob])

  const anyRunning = jobs.some((j) => j.status === 'running' || j.status === 'queued')
  useEffect(() => {
    void refreshJobs()
    const iv = window.setInterval(refreshJobs, anyRunning ? 500 : 4000)
    return () => window.clearInterval(iv)
  }, [refreshJobs, anyRunning])

  // 初期フォーカス: 最新の完了実験
  useEffect(() => {
    if (!focusId) {
      const latest = jobs.find((j) => j.status === 'completed' || j.status === 'stopped')
      if (latest) setFocusId(latest.id)
    } else if (jobs.length && !jobs.some((j) => j.id === focusId)) {
      setFocusId(null)
    }
  }, [jobs, focusId])

  const model = models.find((m) => m.id === modelId)
  const scale = scales[modelId] ?? model?.params[0]?.default ?? 1
  const setScale = useCallback((v: number) => setScales((s) => ({ ...s, [modelId]: v })), [modelId])

  const toggleCompare = useCallback((id: string) => {
    setCompareIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id].slice(-MAX_COMPARE)))
  }, [])

  const value = useMemo<AppState>(
    () => ({
      tab, setTab, online, models, modelId, setModelId, scale, setScale, jobs, refreshJobs,
      focusId, setFocusId, compareIds, toggleCompare,
      getJob: (id) => jobCache[id], loadJob,
    }),
    [tab, setTab, online, models, modelId, scale, setScale, jobs, refreshJobs, focusId, compareIds, toggleCompare, jobCache, loadJob],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('AppProvider がありません')
  return v
}

/** ジョブ詳細（結果を含む）を取得・キャッシュするフック */
export function useJob(id: string | null): Job | undefined {
  const { getJob, loadJob, jobs } = useApp()
  const summary = jobs.find((j) => j.id === id)
  const job = id ? getJob(id) : undefined
  useEffect(() => {
    if (id && (!job || (summary && summary.status !== job.status))) void loadJob(id)
  }, [id, job, summary, loadJob])
  return job
}
