import type { ProgressPlan, ProgressStatus, ProgressStep } from '../types'

export const STATUSES: readonly ProgressStatus[] = ['pending', 'in_progress', 'completed']

// Past this many steps a segment gets too thin to read, so the bar turns continuous.
export const MAX_SEGMENTS = 12

export type Summary = {
  done: number
  total: number
  current: ProgressStep | undefined
  // 1-based position of the step being worked on, or of the last one when all are done.
  position: number
  isComplete: boolean
}

export type Tone = 'done' | 'current' | 'pending'

export type Run = { text: string; tone: Tone }

// Accepts this plugin's steps, TodoWrite todos and task list files alike.
export function toSteps(value: unknown): ProgressStep[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (typeof item !== 'object' || item === null) return []
    const raw = item as Record<string, unknown>
    const title = [raw.title, raw.content, raw.subject].find(
      (v): v is string => typeof v === 'string' && v.trim() !== '',
    )
    if (title === undefined) return []
    const status = STATUSES.includes(raw.status as ProgressStatus)
      ? (raw.status as ProgressStatus)
      : 'pending'
    return [{ title: title.trim(), status }]
  })
}

export function summarize(plan: ProgressPlan): Summary {
  const { steps } = plan
  const done = steps.filter(step => step.status === 'completed').length
  const total = steps.length
  const running = steps.findIndex(step => step.status === 'in_progress')
  const at = running >= 0 ? running : steps.findIndex(step => step.status === 'pending')
  return {
    done,
    total,
    current: at >= 0 ? steps[at] : undefined,
    position: at >= 0 ? at + 1 : total,
    isComplete: total > 0 && done === total,
  }
}

export function hasSteps(plan: ProgressPlan | null): plan is ProgressPlan {
  return plan !== null && plan.steps.length > 0
}

export function filled(done: number, total: number, width: number): number {
  if (total === 0) return 0
  return Math.round((Math.min(done, total) / total) * width)
}

export function barWidth(columns: number | undefined): number {
  return Math.max(12, Math.min(30, Math.floor((columns ?? 80) / 5)))
}

function merge(runs: Run[]): Run[] {
  return runs.reduce<Run[]>((out, run) => {
    const last = out[out.length - 1]
    if (last && last.tone === run.tone) last.text += run.text
    else out.push({ ...run })
    return out
  }, [])
}

// Terminal bar: one continuous line, since spaced segments read as a dashed rule
// in most terminal fonts; the running step keeps one step's width of the accent.
export function barRuns(steps: readonly ProgressStep[], width: number): Run[] {
  const n = steps.length
  if (n === 0) return []
  const done = filled(steps.filter(s => s.status === 'completed').length, n, width)
  const running = steps.some(s => s.status === 'in_progress')
    ? Math.min(width - done, Math.max(1, Math.round(width / n)))
    : 0
  return merge([
    { text: '━'.repeat(done), tone: 'done' },
    { text: '━'.repeat(running), tone: 'current' },
    { text: '━'.repeat(width - done - running), tone: 'pending' },
  ]).filter(run => run.text !== '')
}

const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/

export function isCjk(plan: ProgressPlan | null): boolean {
  if (plan === null) return false
  return CJK.test(plan.goal) || plan.steps.some(step => CJK.test(step.title))
}

// Identifies the running step; pending steps do not count, as nothing runs yet.
export function stepKeyOf(steps: readonly ProgressStep[]): string | undefined {
  const index = steps.findIndex(step => step.status === 'in_progress')
  const step = steps[index]
  return step === undefined ? undefined : `${index + 1}:${step.title}`
}

function isCompleteList(steps: readonly ProgressStep[]): boolean {
  return steps.length > 0 && steps.every(step => step.status === 'completed')
}

// Carries the plan's start and the running step's start across reports, so a
// re-sent list does not restart the clocks.
export function withTiming(next: ProgressPlan, previous: ProgressPlan | null, now: number): ProgressPlan {
  const isContinuing = previous !== null && !isCompleteList(previous.steps)
  const stepKey = stepKeyOf(next.steps)
  const isSameStep = isContinuing && stepKey !== undefined && stepKey === previous.stepKey
  return {
    ...next,
    startedAt: isContinuing ? (previous.startedAt ?? now) : now,
    stepKey,
    stepStartedAt: stepKey === undefined ? undefined : isSameStep ? (previous.stepStartedAt ?? now) : now,
  }
}

export function stepElapsed(plan: ProgressPlan, now: number): number | undefined {
  if (plan.stepStartedAt === undefined || plan.stepKey === undefined) return undefined
  return Math.max(0, now - plan.stepStartedAt)
}

export function isStuck(plan: ProgressPlan, now: number, thresholdMs: number): boolean {
  const elapsed = stepElapsed(plan, now)
  return thresholdMs > 0 && elapsed !== undefined && elapsed >= thresholdMs
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
