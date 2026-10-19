import type {
  Constraint,
  ExperimentResult,
  ExperimentType,
  Job,
  JobSummary,
  LightCones,
  ModelInfo,
  Profile,
  Verification,
} from './types'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    let msg = res.statusText
    try {
      const body = await res.json()
      msg = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body)
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg)
  }
  return res.json() as Promise<T>
}

export interface ExperimentRequest {
  type: ExperimentType
  model: string
  params: Record<string, unknown>
  label?: string
}

export const api = {
  health: () => request<{ status: string }>('/health'),
  models: () => request<ModelInfo[]>('/models'),
  verification: (id: string) => request<Verification>(`/models/${id}/verification`),
  profile: (id: string, scale: number, rMax = 3) =>
    request<Profile>(`/models/${id}/profile?scale=${scale}&r_max=${rMax}`),
  lightcones: (id: string, scale: number, rMax = 2.4, nR = 7, nPhi = 8) =>
    request<LightCones>(`/models/${id}/lightcones?scale=${scale}&r_max=${rMax}&n_r=${nR}&n_phi=${nPhi}`),
  constraints: () => request<Constraint[]>('/constraints'),
  experiments: () => request<JobSummary[]>('/experiments'),
  experiment: (id: string) => request<Job>(`/experiments/${id}`),
  start: (req: ExperimentRequest) => request<JobSummary>('/experiments', { method: 'POST', body: JSON.stringify(req) }),
  preview: (req: ExperimentRequest) =>
    request<{ result: ExperimentResult }>('/experiments', { method: 'POST', body: JSON.stringify({ ...req, preview: true }) }),
  stop: (id: string) => request<JobSummary>(`/experiments/${id}/stop`, { method: 'POST' }),
  remove: (id: string) => request<{ deleted: string }>(`/experiments/${id}`, { method: 'DELETE' }),
  downloadUrl: (id: string) => `/api/experiments/${id}/download`,
}
