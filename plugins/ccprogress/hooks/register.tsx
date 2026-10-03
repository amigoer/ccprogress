import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, Timer } from 'claude-code'

import type { ProgressPlan, ProgressSource, ProgressStep } from '../types'
import { formatDuration, hasSteps, isCjk, isStuck, stepElapsed, summarize, toSteps, withTiming } from './plan'
import { checklist, progressRow, reportLine, TERMINAL_INDENT, textSummary } from './view'
import type { Elapsed } from './view'
import { setLanguage, wordsFor } from './words'
import type { Language } from './words'

const PANE = 'ccprogress'
const TOOL_NAME = 'update_progress'
const TOOL = 'mcp__ccprogress__update_progress'
const KEEP_SESSIONS = 50
const BUILTIN_LISTS = ['TodoWrite', 'TaskCreate']
const TASK_TOOLS = ['TaskCreate', 'TaskUpdate']
// The terminal's Enter, the Desktop app (an SDK host) and Remote Control.
const HUMAN_ORIGINS = ['composer', 'sdk', 'bridge']

const plan = atom({ plugin: 'ccprogress', key: 'plan' } as const, null)
const isExpanded = atom({ plugin: 'ccprogress', key: 'isExpanded' } as const, false)
const isWorking = atom({ plugin: 'ccprogress', key: 'isWorking' } as const, false)
// Wall time, written once a second while a turn runs; drawings that read it redraw with it.
const tick = atom({ plugin: 'ccprogress', key: 'tick' } as const, 0)

type Config = { stuckMs: number; notify: 'toast' | 'system'; foldReports: boolean; language: Language }

let config: Config = { stuckMs: 5 * 60_000, notify: 'toast', foldReports: true, language: 'auto' }
let ticker: Timer | undefined
// The step already warned about, so one stuck step raises one alert.
let alertedStep: string | undefined
// Main-loop actions in the running turn, and whether it reported or was reminded.
let callsThisTurn = 0
let reportedThisTurn = false
let nudgedThisTurn = false

function configFrom(options: PluginOptions): Config {
  const minutes = Number(options.stuck_minutes ?? 5)
  return {
    stuckMs: Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : 0,
    notify: options.notify === 'system' ? 'system' : 'toast',
    foldReports: options.fold_reports !== false,
    language: options.language === 'en' || options.language === 'zh' ? options.language : 'auto',
  }
}

const TOOL_DESCRIPTION = [
  'Show the user a live progress bar for the current task; without it they only see elapsed time and tokens.',
  'Call it as soon as you know a task takes three or more steps (editing several files, running and fixing',
  'tests, a request with several parts), before the first step, listing every step.',
  'Call it again whenever a step starts or finishes, always sending the whole list with exactly one step',
  'in_progress, and once more when every step is done. If you notice midway that a task has several steps,',
  'call it then. Skip it for single-step requests and plain questions.',
].join(' ')

const GUIDE = [
  '# Progress reporting',
  `The user follows long tasks through a progress bar fed by the ${TOOL} tool; it is all they see of your plan.`,
  'When a task takes three or more steps, call it before the first step with every step listed, even when the',
  'request did not spell the steps out. Call it again whenever a step starts or finishes, sending the full',
  'list with exactly one step in_progress, and once more when all steps are done.',
  "Write step titles as short verb phrases (under eight words) in the user's language.",
  'Revise the list when the plan changes. Skip it for one-step requests and plain questions.',
].join('\n')

// A turn this many actions deep without a report gets one reminder the model reads.
const NUDGE_AFTER_CALLS = 4
const NUDGE_NEW = `This task has already taken several actions. If more steps remain, call ${TOOL} with the full plan so the user can follow along.`
const NUDGE_STALE = `The progress bar still shows an unfinished plan. Call ${TOOL} to mark the finished steps and the step under way, or to report a new plan.`

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    goal: { type: 'string', description: 'The whole task in a few words' },
    steps: {
      type: 'array',
      description: 'Every step of the task, in order',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'A short verb phrase' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
        },
        required: ['title', 'status'],
      },
    },
  },
  required: ['steps'],
}

function isPlan(value: unknown): value is ProgressPlan {
  return typeof value === 'object' && value !== null && Array.isArray((value as ProgressPlan).steps)
}

async function persist($: EngineInterface, next: ProgressPlan | null) {
  await update($, plan, () => next)
  if (next === null) await update($, isExpanded, () => false)
  const key = `plan:${await $.session.id()}`
  if (next === null) await $.store.delete(key)
  else await $.store.set(key, next)
}

async function restore($: EngineInterface, sessionId: string) {
  const saved = await $.store.get(`plan:${sessionId}`)
  await update($, plan, () => (isPlan(saved) ? saved : null))
}

// Each session keeps its plan for /resume; only the newest few are worth keeping.
async function prune($: EngineInterface) {
  const keys = (await $.store.keys()).filter(key => key.startsWith('plan:'))
  if (keys.length <= KEEP_SESSIONS) return
  const dated = await Promise.all(
    keys.map(async key => {
      const value = await $.store.get(key)
      return { key, at: isPlan(value) ? value.updatedAt : 0 }
    }),
  )
  dated.sort((a, b) => b.at - a.at)
  for (const { key } of dated.slice(KEEP_SESSIONS)) await $.store.delete(key)
}

// Step titles come from the model, so they are escaped before AppleScript reads them.
function appleString(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

async function notify($: EngineInterface, text: string) {
  $.ui.toast(text, { timeoutMs: 8000 })
  if (config.notify !== 'system') return
  try {
    await $.process.run(['osascript', '-e', `display notification ${appleString(text)} with title "ccprogress"`])
  } catch {
    try {
      await $.process.run(['notify-send', 'ccprogress', text])
    } catch {
      // Neither notifier exists here; the toast already showed.
    }
  }
}

async function adopt($: EngineInterface, steps: ProgressStep[], source: ProgressSource, goal?: string) {
  if (steps.length === 0) return persist($, null)
  const previous = await read($, plan)
  const now = await $.clock.now()
  const next = withTiming({ goal: goal ?? previous?.goal ?? '', steps, source, updatedAt: now }, previous, now)
  await persist($, next)
  const s = summarize(next)
  const wasComplete = previous !== null && summarize(previous).isComplete
  if (s.isComplete && !wasComplete) {
    const words = wordsFor(isCjk(next))
    await notify($, words.doneToast(s.total, next.goal, formatDuration(now - (next.startedAt ?? now))))
  }
}

async function tickOnce($: EngineInterface) {
  const now = await $.clock.now()
  await update($, tick, () => now)
  const p = await read($, plan)
  if (!hasSteps(p) || !isStuck(p, now, config.stuckMs)) return
  const key = `${p.stepKey}@${p.stepStartedAt}`
  if (key === alertedStep) return
  alertedStep = key
  const title = p.steps.find(step => step.status === 'in_progress')?.title ?? ''
  await notify($, wordsFor(isCjk(p)).stuckToast(title, formatDuration(stepElapsed(p, now) ?? 0)))
}

async function elapsedOf($: EngineInterface, p: ProgressPlan): Promise<Elapsed | undefined> {
  const now = Math.max(await read($, tick), p.updatedAt)
  const ms = stepElapsed(p, now)
  if (ms === undefined) return undefined
  return { text: formatDuration(ms), isStuck: isStuck(p, now, config.stuckMs) }
}

// The task list tools write one JSON file per task; reading them back is
// sturdier than replaying TaskCreate/TaskUpdate inputs.
async function readTaskList($: EngineInterface): Promise<ProgressStep[] | null> {
  const home = await $.env.get('HOME')
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (home ? `${home}/.claude` : undefined)
  if (configDir === undefined) return null
  const listId = (await $.env.get('CLAUDE_CODE_TASK_LIST_ID')) ?? (await $.session.id())
  const dir = `${configDir}/tasks/${listId}`
  try {
    const files = (await $.fs.list(dir)).filter(entry => entry.kind === 'file' && entry.name.endsWith('.json'))
    const tasks = await Promise.all(
      files.map(async entry => {
        try {
          return JSON.parse(await $.fs.read(`${dir}/${entry.name}`)) as Record<string, unknown>
        } catch {
          return null
        }
      }),
    )
    const order = (task: Record<string, unknown>) => Number(task.id) || 0
    return toSteps(
      tasks
        .filter((task): task is Record<string, unknown> => task !== null && task.status !== 'deleted')
        .sort((a, b) => order(a) - order(b)),
    )
  } catch {
    return null
  }
}

export const register: Register = (on, options) => {
  config = configFrom(options)
  setLanguage(config.language)

  on('session.start', async ($, e, next) => {
    const tools = await $.tool.list()
    if (!tools.some(tool => BUILTIN_LISTS.includes(tool.name))) {
      await $.tool.register({ name: TOOL_NAME, description: TOOL_DESCRIPTION, inputSchema: INPUT_SCHEMA })
    }
    await $.command.register({
      name: 'progress',
      description: 'Show the current task progress',
      argumentHint: '[clear]',
      immediate: true,
    })
    await restore($, await $.session.id())
    await prune($)
    return next(e)
  })

  // /clear, /resume and /branch reset $.state without a new session.start.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await restore($, e.session_id)
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!e.tools.includes(TOOL)) return composed
    return {
      sections: [...composed.sections, { id: 'ccprogress:guide', text: GUIDE, scope: 'session' as const }],
    }
  })

  // A finished plan stays on screen until the person moves on.
  on('prompt.submit', async ($, e, next) => {
    if (HUMAN_ORIGINS.includes(e.origin.kind)) {
      const p = await read($, plan)
      if (hasSteps(p) && summarize(p).isComplete) await persist($, null)
    }
    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as { goal?: unknown; steps?: unknown }
    const steps = toSteps(input.steps)
    if (steps.length === 0) {
      return { deny: 'steps must be a non-empty list of { title, status }.' }
    }
    if (e.agentId !== undefined) {
      return { result: 'Noted. Only the main conversation plan is shown to the user.' }
    }
    const goal = typeof input.goal === 'string' && input.goal.trim() !== '' ? input.goal.trim() : undefined
    reportedThisTurn = true
    await adopt($, steps, 'tool', goal)
    const s = summarize({ goal: '', steps, source: 'tool', updatedAt: 0 })
    return { result: `Progress shown to the user: ${s.done}/${s.total} steps done.` }
  })

  // Built-in task lists, where the build has them, feed the same view; a long turn
  // with no report at all gets one reminder appended to a tool result.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const name: string = e.tool
    if (e.agentId !== undefined || ran.deny !== undefined || name === TOOL) return ran
    if (ran.isError !== true) {
      if (name === 'TodoWrite') {
        reportedThisTurn = true
        await adopt($, toSteps((e as unknown as { todos?: unknown }).todos), 'todo')
      } else if (TASK_TOOLS.includes(name)) {
        reportedThisTurn = true
        const steps = await readTaskList($)
        if (steps !== null) await adopt($, steps, 'tasks')
      }
    }
    callsThisTurn += 1
    if (reportedThisTurn || nudgedThisTurn || callsThisTurn < NUDGE_AFTER_CALLS) return ran
    if (!(await $.tool.list()).some(tool => tool.name === TOOL)) return ran
    nudgedThisTurn = true
    const p = await read($, plan)
    const reminder = hasSteps(p) && !summarize(p).isComplete ? NUDGE_STALE : NUDGE_NEW
    return { ...ran, context: [...(ran.context ?? []), reminder] }
  })

  on('command.run', { command: 'progress' }, async ($, e) => {
    const p = await read($, plan)
    const words = wordsFor(isCjk(p))
    if (e.args.trim() === 'clear') {
      await persist($, null)
      return { text: words.cleared }
    }
    const surfaces = await $.session.surfaces()
    if (!surfaces.some(surface => surface === 'terminal' || surface === 'desktop')) {
      return { text: textSummary(p) }
    }
    if (surfaces.includes('terminal')) {
      const opened = await $.ui.open({ id: PANE, title: 'Progress' })
      if (opened.isPlaced) return {}
    }
    // The Desktop app does not seat a pane here, so the band unfolds instead.
    if (!hasSteps(p)) return { text: words.empty }
    await update($, isExpanded, () => true)
    return {}
  })

  // Subagent runs raise no turn.start, and their turn.complete carries an agentId.
  on('turn.start', async ($, e, next) => {
    callsThisTurn = 0
    reportedThisTurn = false
    nudgedThisTurn = false
    await update($, isWorking, () => true)
    ticker?.cancel()
    ticker = $.clock.every(1000, () => {
      tickOnce($).catch(() => undefined)
    })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, isWorking, () => false)
      ticker?.cancel()
      ticker = undefined
    }
    return next(e)
  })

  // The terminal draws the bar right above the spinner's time and tokens. The
  // Desktop app draws its spinner row itself and takes no tree or props there.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const p = await read($, plan)
    if (e.surface !== 'terminal' || !hasSteps(p)) return next(e)
    const theirs = await next(e)
    const kit = $.ui.resolve(e)
    const { Box } = kit
    // The spinner brings its own blank line above it; ours sets the bar off the transcript.
    return (
      <Box flexDirection="column">
        <Box marginTop={1}>
          {progressRow(kit, p, {
            surface: e.surface,
            columns: e.viewport?.columns,
            isWorking: true,
            elapsed: await elapsedOf($, p),
          })}
        </Box>
        {theirs}
      </Box>
    )
  })

  // The band carries the bar whenever the spinner row cannot: while idle, and on
  // the Desktop app throughout. Unfolded, it lists every step.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.view.agentId !== undefined) return next(e)
    const p = await read($, plan)
    const expanded = await read($, isExpanded)
    const isSpinnerShowing = e.props.isWorking && e.surface === 'terminal'
    if (!hasSteps(p) || (isSpinnerShowing && !expanded)) return next(e)
    const kit = $.ui.resolve(e)
    const { Box, Button, Text } = kit
    const s = summarize(p)
    const words = wordsFor(isCjk(p))
    // Keep what other mods draw here, but not the engine's empty band.
    const below = await next(e)
    const lead = isSpinnerShowing ? (
      <Box paddingLeft={TERMINAL_INDENT} flexShrink={1}>
        <Text dimColor wrap="truncate-end">
          {p.goal !== '' ? p.goal : words.stepsDone(s.done, s.total)}
        </Text>
      </Box>
    ) : (
      progressRow(kit, p, {
        surface: e.surface,
        columns: e.props.bodyColumns,
        isWorking: e.props.isWorking,
        elapsed: await elapsedOf($, p),
      })
    )
    const dismiss =
      e.surface === 'terminal' ? (
        <Button key="dismiss" label="×" plain onPress={() => persist($, null)} />
      ) : (
        <Button key="dismiss" role="dismiss" label={words.dismiss} onPress={() => persist($, null)} />
      )
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" alignItems="center" columnGap={2}>
          {lead}
          <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
            <Button
              key="toggle"
              label={expanded ? `${words.hideSteps} ▴` : `${words.viewSteps} ▾`}
              onPress={() => update($, isExpanded, value => !value)}
            />
            {s.isComplete && dismiss}
          </Box>
        </Box>
        {expanded && (
          <Box marginTop={1} flexDirection="column">
            {checklist(kit, e.surface, p, e.props.isWorking)}
          </Box>
        )}
        {below.type !== 'engine' && below}
      </Box>
    )
  })

  // The terminal prints each report's whole step list; fold it to one dim line and
  // drop its result. Errors keep the engine's row, and the Desktop app folds tool
  // rows on its own.
  on('ui.render', { component: 'ToolUse', props: { tool: TOOL } }, async ($, e, next) => {
    if (!config.foldReports || e.surface !== 'terminal' || e.props.isErrored || e.props.isInterrupted) return next(e)
    const steps = toSteps((e.props.input as { steps?: unknown } | undefined)?.steps)
    if (steps.length === 0) return next(e)
    const goal = (e.props.input as { goal?: unknown }).goal
    const { Text } = $.ui.resolve(e)
    const line = reportLine({ goal: typeof goal === 'string' ? goal : '', steps, source: 'tool', updatedAt: 0 })
    return <Text dimColor wrap="truncate-end">◦ {line}</Text>
  })

  on('ui.render', { component: 'ToolResult', props: { tool: TOOL } }, async ($, e, next) => {
    if (!config.foldReports || e.surface !== 'terminal' || e.props.isErrored) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const kit = $.ui.resolve(e)
    const { Box, Text, Button } = kit
    const p = await read($, plan)
    const working = await read($, isWorking)
    const words = wordsFor(isCjk(p))
    if (!hasSteps(p)) return <Text dimColor>{words.empty}</Text>
    return (
      <Box flexDirection="column" rowGap={1}>
        {p.goal !== '' && <Text bold>{p.goal}</Text>}
        {progressRow(kit, p, {
          surface: e.surface,
          columns: e.props.bodyColumns,
          isWorking: working,
          elapsed: await elapsedOf($, p),
        })}
        {checklist(kit, e.surface, p, working)}
        <Button key="clear" label={words.clear} onPress={() => persist($, null)} />
      </Box>
    )
  })
}
