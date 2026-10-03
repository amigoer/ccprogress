import type { Elements, RenderNode, RenderSurface } from 'claude-code'

import type { ProgressPlan, ProgressStatus } from '../types'
import { barSvg, phaseIconSvg, stepIconSvg, svgWidth } from './icons'
import type { Phase } from './icons'
import { barRuns, barWidth, isCjk, summarize } from './plan'
import type { Tone } from './plan'
import { wordsFor } from './words'

export const ACCENT = '#d97757'
const SUCCESS = '#22a06b'
const WARNING = '#d1453b'
const PALETTE = { done: SUCCESS, current: ACCENT }
const GLYPHS: Record<ProgressStatus, string> = { completed: '✓', in_progress: '●', pending: '○' }
const PHASE_ALT: Record<Phase, string> = { working: 'In progress', paused: 'Paused', done: 'Done' }
const STATUS_ALT: Record<ProgressStatus, string> = { completed: 'Done', in_progress: 'In progress', pending: 'Pending' }

export type Kit = Elements[RenderSurface]

export function phaseOf(plan: ProgressPlan, isWorking: boolean): Phase {
  if (summarize(plan).isComplete) return 'done'
  return isWorking ? 'working' : 'paused'
}

// Decided by the surface: every table answers to Svg, but the terminal draws it empty.
function svgOf(kit: Kit, surface: RenderSurface) {
  return surface === 'terminal' ? undefined : (kit as Elements['desktop']).Svg
}

function toneProps(tone: Tone) {
  if (tone === 'done') return { color: SUCCESS }
  if (tone === 'current') return { color: ACCENT }
  return { dimColor: true }
}

// Desktop only: the terminal row carries no icon, so it never reads as a tool call.
function phaseIcon(kit: Kit, phase: Phase): RenderNode {
  const { Svg } = kit as Elements['desktop']
  // Only an interactive SVG animates; the static states stay plain images.
  return <Svg source={phaseIconSvg(phase, PALETTE)} alt={PHASE_ALT[phase]} width={16} height={16} isInteractive={phase === 'working'} />
}

function stepIcon(kit: Kit, surface: RenderSurface, status: ProgressStatus, isWorking: boolean): RenderNode {
  const Svg = svgOf(kit, surface)
  if (Svg) {
    const isAnimated = isWorking && status === 'in_progress'
    return <Svg source={stepIconSvg(status, PALETTE, isAnimated)} alt={STATUS_ALT[status]} width={14} height={14} isInteractive={isAnimated} />
  }
  const { Text } = kit
  const tone: Tone = status === 'completed' ? 'done' : status === 'in_progress' ? 'current' : 'pending'
  return <Text {...toneProps(tone)}>{GLYPHS[status]}</Text>
}

function bar(kit: Kit, surface: RenderSurface, plan: ProgressPlan, columns: number | undefined, isWorking: boolean): RenderNode {
  const Svg = svgOf(kit, surface)
  if (Svg) {
    const s = summarize(plan)
    const width = svgWidth(s.total)
    return (
      <Svg
        source={barSvg(plan.steps, width, PALETTE, isWorking)}
        alt={`${s.done} of ${s.total} steps done`}
        width={width}
        height={4}
        isInteractive={isWorking}
      />
    )
  }
  const { Text } = kit
  return (
    <Text>
      {barRuns(plan.steps, barWidth(columns)).map((run, i) => (
        <Text key={`bar-${i}`} {...toneProps(run.tone)}>
          {run.text}
        </Text>
      ))}
    </Text>
  )
}

// How long the running step has taken, shown while a turn runs.
export type Elapsed = { text: string; isStuck: boolean }

export type RowOptions = {
  surface: RenderSurface
  columns: number | undefined
  isWorking: boolean
  elapsed?: Elapsed | undefined
}

// The terminal lines it up with the spinner's text, the spinner's glyph being two cells.
export const TERMINAL_INDENT = 2

// Desktop: what is happening on the left, how far along on the right. Terminal:
// one left-aligned line, bar first, as a terminal progress bar reads.
export function progressRow(kit: Kit, plan: ProgressPlan, { surface, columns, isWorking, elapsed }: RowOptions): RenderNode {
  const { Box, Text } = kit
  const s = summarize(plan)
  const words = wordsFor(isCjk(plan))
  const phase = phaseOf(plan, isWorking)
  const count = (
    <Text dimColor>
      {s.position}/{s.total}
    </Text>
  )
  const timer =
    phase === 'working' && elapsed !== undefined ? (
      <Text {...(elapsed.isStuck ? { color: WARNING } : { dimColor: true })}>· {elapsed.text}</Text>
    ) : null
  if (surface === 'terminal') {
    return (
      <Box key="progress-row" flexDirection="row" columnGap={2} paddingLeft={TERMINAL_INDENT} flexShrink={1}>
        {bar(kit, surface, plan, columns, false)}
        {count}
        {phase === 'done' ? (
          <Box flexDirection="row" columnGap={1} flexShrink={1}>
            <Text color={SUCCESS}>✓ {words.allDone}</Text>
            {plan.goal !== '' && (
              <Text dimColor wrap="truncate-end">
                {plan.goal}
              </Text>
            )}
          </Box>
        ) : (
          <Box flexDirection="row" columnGap={1} flexShrink={1}>
            <Text wrap="truncate-end">{s.current?.title ?? ''}</Text>
            {timer}
          </Box>
        )}
      </Box>
    )
  }
  return (
    <Box key="progress-row" flexDirection="row" alignItems="center" columnGap={2} flexGrow={1} flexShrink={1}>
      <Box flexDirection="row" alignItems="center" columnGap={1} flexGrow={1} flexShrink={1}>
        {phaseIcon(kit, phase)}
        <Text wrap="truncate-end">{phase === 'done' ? words.allDone : (s.current?.title ?? '')}</Text>
        {timer}
        {phase === 'done' && plan.goal !== '' && (
          <Text dimColor wrap="truncate-end">
            {plan.goal}
          </Text>
        )}
      </Box>
      <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
        {bar(kit, surface, plan, columns, phase === 'working')}
        {count}
      </Box>
    </Box>
  )
}

export function checklist(kit: Kit, surface: RenderSurface, plan: ProgressPlan, isWorking: boolean): RenderNode {
  const { Box, Text } = kit
  return (
    <Box key="checklist" flexDirection="column" paddingLeft={surface === 'terminal' ? TERMINAL_INDENT : 0}>
      {plan.steps.map((step, i) => (
        <Box key={`step-${i}`} flexDirection="row" alignItems="center" columnGap={1}>
          {stepIcon(kit, surface, step.status, isWorking)}
          <Text dimColor={step.status === 'completed'} bold={step.status === 'in_progress'} wrap="truncate-end">
            {step.title}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

// One line per report in the transcript: the plan when it is laid out, then the step
// it moved to, then the finish.
export function reportLine(plan: ProgressPlan): string {
  const words = wordsFor(isCjk(plan))
  const s = summarize(plan)
  if (s.isComplete) return `${s.total}/${s.total} ${words.allDone}`
  if (s.done === 0 && s.position === 1) return [words.planOf(s.total), plan.goal].filter(part => part !== '').join(' · ')
  return `${s.position}/${s.total} ${s.current?.title ?? ''}`
}

export function textSummary(plan: ProgressPlan | null): string {
  const words = wordsFor(isCjk(plan))
  if (plan === null || plan.steps.length === 0) return words.empty
  const s = summarize(plan)
  const lines = plan.steps.map(step => `${GLYPHS[step.status]} ${step.title}`)
  return [plan.goal, words.stepsDone(s.done, s.total), ...lines].filter(line => line !== '').join('\n')
}
