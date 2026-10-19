export type MathVerdict = '成立' | '不成立' | '判定不能'
export type JobStatus = 'queued' | 'running' | 'completed' | 'stopped' | 'failed'
export type ExperimentType = 'circle' | 'geodesic' | 'mission'
export type Causal = 'timelike' | 'spacelike' | 'boundary'

export interface ParamSpec {
  key: string
  label: string
  default: number
  min: number
  max: number
  unit: string
  description: string
}

export interface ModelInfo {
  id: string
  name: string
  description: string
  metric_text: string
  metric_latex: string
  signature: string
  coordinates: string[]
  units: string
  params: ParamSpec[]
  references: { citation: string; note: string }[]
  critical_radius: string | null
  known_results: string[]
}

export interface Verification {
  model: string
  metric_components: { index: string; text: string }[]
  ricci_scalar: { text: string }
  einstein_nonzero: { index: string; text: string }[]
  ansatz: string
  solved: boolean
  Lambda: { text: string } | null
  rho: { text: string } | null
  eight_pi_rho: { text: string } | null
  method: string
}

export interface Verdict {
  math: MathVerdict
  physical: string
  label: string
  reason: string
}

export interface Evidence {
  label: string
  formula: string
  value: number | string | null
  unit: string
  detail: string
}

export interface Comparison {
  label: string
  numeric: number | null
  analytic: number | null
  analytic_label: string
  abs_error: number | null
  rel_error: number | null
  method: string
}

export interface ErrorItem {
  label: string
  value: number | null
  note: string
}

export interface Metric {
  label: string
  value: number | null
  unit: string
}

export interface ChartSpec {
  id: string
  title: string
  x: { key: string; label: string }
  lines: { key: string; label: string }[]
  data: Record<string, number | null>[]
  refs: { axis: 'x' | 'y'; value: number; label: string }[]
  yScale?: 'linear' | 'log'
}

export interface PathSegment {
  label: string
  points: [number, number, number][]
  causal: Causal
  highlight: boolean
}

export interface Classification {
  total: number
  timelike: number
  spacelike: number
  boundary: number
  past_directed: number
  direction_undetermined: number
  overall: string
  label: string
}

export interface ExperimentResult {
  type: ExperimentType
  title: string
  model: string
  params: Record<string, unknown>
  verdict: Verdict
  is_ctc: boolean | null
  classification: Classification
  evidence: Evidence[]
  comparisons: Comparison[]
  errors: ErrorItem[]
  metrics: Record<string, Metric>
  charts: ChartSpec[]
  path: { segments: PathSegment[]; closed: boolean }
  warnings: string[]
  caveats: string[]
}

export interface JobSummary {
  id: string
  seq: number
  name: string
  label: string | null
  type: ExperimentType
  model: string
  params: Record<string, unknown>
  status: JobStatus
  progress: number
  message: string
  created_at: number
  started_at: number | null
  finished_at: number | null
  error: string | null
  title: string | null
  verdict: Verdict | null
  is_ctc: boolean | null
  metrics: Record<string, Metric> | null
}

export interface Job extends JobSummary {
  result: ExperimentResult | null
}

export interface Constraint {
  id: string
  title: string
  status: string
  severity: 'critical' | 'high' | 'medium'
  detail: string
  source: string
  computed?: boolean
}

export interface ProfileRow {
  r: number
  g_tt: number
  g_tphi: number
  g_phiphi: number
  g_rr: number
  cone_tilt: number
  alpha_max: number
}

export interface Profile {
  model: string
  critical_radius: number | null
  rows: ProfileRow[]
  notes: Record<string, string>
}

export interface Cone {
  r: number
  phi: number
  apex: [number, number, number]
  ring: [number, number, number][]
  tipped: boolean
  beyond_critical: boolean
}

export interface LightCones {
  model: string
  critical_radius: number | null
  embedding: string
  cones: Cone[]
  note: string
}
