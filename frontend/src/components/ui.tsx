import type { ReactNode } from 'react'
import type { JobStatus, MathVerdict } from '../api/types'
import { STATUS_LABEL } from '../lib/format'

export function Panel({ title, code, actions, children, className = '' }: {
  title?: ReactNode
  code?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`relative rounded-md border border-line bg-panel/95 ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold tracking-wide text-ink">
            <span className="inline-block h-3 w-1 rounded-sm bg-accent" />
            {title}
            {code && <span className="num text-[11px] font-normal text-ink-3">{code}</span>}
          </h2>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

const VERDICT_STYLE: Record<MathVerdict, { cls: string; icon: string }> = {
  成立: { cls: 'border-ctc/60 bg-ctc/15 text-[#f4a6c3]', icon: '◆' },
  不成立: { cls: 'border-line-strong bg-panel-2 text-ink-2', icon: '○' },
  判定不能: { cls: 'border-warn/60 bg-warn/10 text-warn', icon: '⚠' },
}

export function VerdictBadge({ math, size = 'md' }: { math: MathVerdict | null | undefined; size?: 'sm' | 'md' | 'lg' }) {
  if (!math) return <span className="text-ink-3">—</span>
  const s = VERDICT_STYLE[math]
  const sz = size === 'lg' ? 'px-3 py-1.5 text-base' : size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-xs'
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded border font-semibold ${s.cls} ${sz}`}>
      <span aria-hidden>{s.icon}</span>数学的: {math}
    </span>
  )
}

export function PhysicalBadge({ value = '未確立', size = 'md' }: { value?: string; size?: 'sm' | 'md' | 'lg' }) {
  const sz = size === 'lg' ? 'px-3 py-1.5 text-base' : size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-xs'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded border border-line-strong bg-bg font-semibold text-ink-2 ${sz}`}>
      <span aria-hidden>▢</span>物理的実現性: {value}
    </span>
  )
}

const LAMP: Record<JobStatus, string> = {
  queued: 'bg-ink-3',
  running: 'bg-accent lamp-pulse',
  completed: 'bg-good',
  stopped: 'bg-warn',
  failed: 'bg-bad',
}

export function StatusPill({ status }: { status: JobStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-ink-2">
      <span className={`h-2 w-2 rounded-full ${LAMP[status]}`} />
      {STATUS_LABEL[status]}
    </span>
  )
}

export function Button({ children, onClick, variant = 'default', disabled, type = 'button', title, testId }: {
  children: ReactNode
  onClick?: () => void
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  disabled?: boolean
  type?: 'button' | 'submit'
  title?: string
  testId?: string
}) {
  const v = {
    default: 'border-line-strong bg-panel-2 text-ink hover:border-accent/60',
    primary: 'border-accent/70 bg-accent/15 text-accent hover:bg-accent/25',
    danger: 'border-bad/70 bg-bad/15 text-[#f08a8a] hover:bg-bad/25',
    ghost: 'border-transparent bg-transparent text-ink-2 hover:text-ink',
  }[variant]
  return (
    <button
      type={type}
      title={title}
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${v}`}
    >
      {children}
    </button>
  )
}

export function Stat({ label, value, unit, tone }: { label: string; value: ReactNode; unit?: string; tone?: 'accent' | 'ctc' | 'warn' }) {
  const c = tone === 'ctc' ? 'text-[#f4a6c3]' : tone === 'warn' ? 'text-warn' : tone === 'accent' ? 'text-accent' : 'text-ink'
  return (
    <div className="rounded border border-line bg-panel-2/60 px-3 py-2">
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className={`num mt-0.5 text-xl font-semibold ${c}`}>
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-ink-3">{unit}</span>}
      </div>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded border border-dashed border-line px-4 py-8 text-center text-sm text-ink-3">{children}</div>
}
