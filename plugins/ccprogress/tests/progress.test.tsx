import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

const PLUGIN = 'ccprogress'
const TOOL = 'mcp__ccprogress__update_progress'
const SURFACES = ['terminal', 'desktop'] as const
const STEPS = [
  { title: 'Read the code', status: 'completed' },
  { title: 'Write the fix', status: 'in_progress' },
  { title: 'Run the tests', status: 'pending' },
]
const DONE = STEPS.map(step => ({ ...step, status: 'completed' }))

const SPINNER: RenderPropsOf['Spinner'] = { word: 'Working', message: null, suffix: '…', mode: 'tool-use' }

const band = (isWorking: boolean) =>
  ({
    hasSurvey: false,
    isWorking,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 9, contentRows: 1 },
    view: {},
  }) as unknown as RenderPropsOf['AbovePrompt']

const PANE = {
  title: 'Progress',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 20, contentRows: 6 },
  view: {},
} as unknown as RenderPropsOf['Pane']

// TodoWrite and the task list tools are missing from some builds' tool types.
type LooseCall = (input: Record<string, unknown>) => Promise<unknown>

function world(on: On) {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on)
  on('session.id', () => ({ value: 'session-1' }))
  // Stands in for what the engine draws at its own sites.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    const suffix = e.component === 'Spinner' ? e.props.suffix : ''
    return <Text key="engine">engine{suffix}</Text>
  })
  return clock
}

function toastsOf(on: On): string[] {
  const texts: string[] = []
  on('ui.toast', (_$, e) => {
    texts.push(e.text)
    return { value: undefined }
  })
  return texts
}

function processesOf(on: On, failing: string[] = []): string[][] {
  const runs: string[][] = []
  on('process.run', (_$, e) => {
    runs.push([...e.argv])
    if (failing.includes(e.argv[0] ?? '')) return { deny: 'cannot start' }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } as never }
  })
  return runs
}

function turns(on: On) {
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
}

// Counts the plugin's draws of each site; registered before world() so it runs first.
function drawsOf(on: On) {
  const draws = { AbovePrompt: 0, Spinner: 0 }
  on('ui.render', { component: ['AbovePrompt', 'Spinner'] }, (_$, e, next) => {
    if (e.component === 'AbovePrompt' || e.component === 'Spinner') draws[e.component] += 1
    return next(e)
  })
  return draws
}

test('the terminal draws the bar right above the spinner', async ($, on) => {
  world(on)
  const ran = await $.tool.call({ tool: TOOL, goal: 'Fix login bug', steps: STEPS })
  expect(ran.result).toBe('Progress shown to the user: 1/3 steps done.')

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Spinner', props: SPINNER })
  expect(await ui.find({ type: 'Text', text: 'Write the fix' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '2/3' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /━/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '●' })).toBeUndefined()
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'engine…' })).toBeDefined()
})

test('the desktop spinner row is left to the engine', async ($, on) => {
  world(on)
  await $.tool.call({ tool: TOOL, goal: 'Fix login bug', steps: STEPS })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Spinner', props: SPINNER })
  expect(await ui.find({ type: 'Text', text: 'engine…' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Write the fix' })).toBeUndefined()
})

test('the band shows the bar while idle, and on desktop while working too', async ($, on) => {
  world(on)
  await $.tool.call({ tool: TOOL, goal: 'Fix login bug', steps: STEPS })

  for (const surface of SURFACES) {
    const idle = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: band(false) })
    expect(await idle.find({ type: 'Text', text: 'Write the fix' })).toBeDefined()
    expect(await idle.find({ type: 'Button', key: 'dismiss' })).toBeUndefined()
    await idle.unmount()
  }

  const terminal = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: band(true) })
  expect(await terminal.find({ type: 'Text', text: 'Write the fix' })).toBeUndefined()
  await terminal.unmount()

  const desktop = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: band(true) })
  expect(await desktop.find({ type: 'Text', text: 'Write the fix' })).toBeDefined()
  const svgs = await desktop.findAll({ type: 'Svg' })
  expect(svgs.length).toBe(2)
})

test('view steps unfolds the checklist in the band', async ($, on) => {
  world(on)
  await $.tool.call({ tool: TOOL, goal: 'Fix login bug', steps: STEPS })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: band(false) })
    expect(await ui.find({ type: 'Text', text: 'Run the tests' })).toBeUndefined()
    await ui.press({ key: 'toggle' })
    expect(await ui.find({ type: 'Text', text: 'Run the tests' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'toggle' })).toMatchObject({ text: 'Hide steps ▴' })
    await ui.press({ key: 'toggle' })
    expect(await ui.find({ type: 'Text', text: 'Run the tests' })).toBeUndefined()
    await ui.unmount()
  }
})

test('a finished plan can be dismissed from the band', async ($, on) => {
  world(on)
  for (const surface of SURFACES) {
    await $.tool.call({ tool: TOOL, goal: 'Fix login bug', steps: DONE })
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: band(false) })
    expect(await ui.find({ type: 'Text', text: /All done/ })).toBeDefined()
    await ui.press({ key: 'dismiss' })
    expect(await ui.find({ type: 'Text', text: /All done/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('labels follow a Chinese plan', async ($, on) => {
  world(on)
  await $.tool.call({
    tool: TOOL,
    goal: '修复登录问题',
    steps: [
      { title: '阅读代码', status: 'completed' },
      { title: '编写修复', status: 'in_progress' },
    ],
  })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: band(false) })
    expect(await ui.find({ type: 'Text', text: '编写修复' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '2/2' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'toggle' })).toMatchObject({ text: '查看步骤 ▾' })
    await ui.unmount()
  }
})

test('the pane lists every step and clears on press', async ($, on) => {
  world(on)
  for (const surface of SURFACES) {
    await $.tool.call({ tool: TOOL, goal: 'Fix login bug', steps: STEPS })
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'ccprogress', props: PANE })
    expect(await ui.find({ type: 'Text', text: 'Fix login bug' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Run the tests' })).toBeDefined()
    await ui.press({ key: 'clear' })
    expect(await ui.find({ type: 'Text', text: /No progress reported yet/ })).toBeDefined()
    await ui.unmount()
  }
})

test('/progress unfolds the band where only the Desktop app draws', async ($, on) => {
  world(on)
  on('session.surfaces', () => ({ value: ['desktop'] as const }))
  await $.tool.call({ tool: TOOL, goal: 'Fix login bug', steps: STEPS })
  await $.command.run({
    command: 'progress',
    args: '',
    origin: { kind: 'sdk' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: band(true) })
  expect(await ui.find({ type: 'Text', text: 'Run the tests' })).toBeDefined()
})

test('a subagent cannot replace the main plan', async ($, on) => {
  world(on)
  await $.tool.call({ tool: TOOL, goal: 'Main', steps: STEPS })
  await $.tool.call({ tool: TOOL, agentId: 'sub-1', steps: [{ title: 'Sub step', status: 'in_progress' }] })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Spinner', props: SPINNER })
  expect(await ui.find({ type: 'Text', text: 'Write the fix' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Sub step' })).toBeUndefined()
})

test('an empty step list is refused', async ($, on) => {
  world(on)
  const ran = await $.tool.call({ tool: TOOL, steps: [] })
  expect(ran.deny).toBeDefined()
})

test('TodoWrite feeds the bar where the build has it', async ($, on) => {
  world(on)
  on('tool.call', () => ({ result: {} }))
  await ($.tool.call as unknown as LooseCall)({
    tool: 'TodoWrite',
    todos: [
      { content: 'Plan', status: 'completed', activeForm: 'Planning' },
      { content: 'Build', status: 'in_progress', activeForm: 'Building' },
    ],
  })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Spinner', props: SPINNER })
  expect(await ui.find({ type: 'Text', text: '2/2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Build' })).toBeDefined()
})

test('task list files feed the bar after TaskUpdate', async ($, on) => {
  world(on)
  mock.env(on, { HOME: '/home/me' })
  const files: Record<string, object> = {
    '/home/me/.claude/tasks/session-1/2.json': { id: '2', subject: 'Second', status: 'in_progress' },
    '/home/me/.claude/tasks/session-1/1.json': { id: '1', subject: 'First', status: 'completed' },
    '/home/me/.claude/tasks/session-1/3.json': { id: '3', subject: 'Gone', status: 'deleted' },
  }
  on('fs.list', () => ({
    value: ['2.json', '1.json', '3.json'].map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', (_$, e) => ({ value: JSON.stringify(files[(e as unknown as { path: string }).path]) }))
  on('tool.call', () => ({ result: {} }))

  await ($.tool.call as unknown as LooseCall)({ tool: 'TaskUpdate', taskId: '2', status: 'in_progress' })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Spinner', props: SPINNER })
  expect(await ui.find({ type: 'Text', text: '2/2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Second' })).toBeDefined()
})

test('/progress clear empties the plan', async ($, on) => {
  world(on)
  await $.tool.call({ tool: TOOL, steps: STEPS })
  const out = await $.command.run({
    command: 'progress',
    args: 'clear',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  expect(out.text).toBe('Progress cleared.')
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Spinner', props: SPINNER })
  expect(await ui.find({ type: 'Text', text: '1/3' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '2/3' })).toBeUndefined()
})

test('the system prompt explains the tool only when it is offered', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'hi', scope: 'shared' as const }] }))
  const base = { model: 'm', promptModel: 'm', surfaces: [], outputStyle: null, traits: [] }

  const offered = await $.prompt.compose({ ...base, tools: [TOOL] })
  expect(offered.sections.map(section => section.id)).toEqual(['intro', 'ccprogress:guide'])

  const absent = await $.prompt.compose({ ...base, tools: ['Read'] })
  expect(absent.sections.map(section => section.id)).toEqual(['intro'])
})

const toolRow = (input: unknown, flags: Partial<{ isErrored: boolean }> = {}) =>
  ({
    tool_use_id: 'tu-1',
    tool: TOOL,
    input,
    isRunning: false,
    isErrored: flags.isErrored ?? false,
    isInterrupted: false,
  }) as RenderPropsOf['ToolUse']

test('the terminal folds each report into one line and hides its result', async ($, on) => {
  world(on)
  const row = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'ToolUse', props: toolRow({ steps: STEPS }) })
  expect(await row.find({ type: 'Text', text: '◦ 2/3 Write the fix' })).toBeDefined()
  expect(await row.find({ type: 'Text', text: 'engine' })).toBeUndefined()

  const result = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolResult',
    props: { tool_use_id: 'tu-1', tool: TOOL, output: 'Progress shown', isErrored: false } as RenderPropsOf['ToolResult'],
  })
  expect(await result.findAll({ type: 'Text' })).toHaveLength(0)
})

test('the folded line tells the plan, the step and the finish apart', async ($, on) => {
  world(on)
  const lineOf = async (input: unknown) => {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'ToolUse', props: toolRow(input) })
    const found = await ui.find({ type: 'Text' })
    await ui.unmount()
    return found?.text
  }
  const fresh = [
    { title: '建目录结构', status: 'in_progress' },
    { title: '写核心逻辑', status: 'pending' },
  ]
  expect(await lineOf({ goal: '记账工具', steps: fresh })).toBe('◦ 计划 2 步 · 记账工具')
  expect(await lineOf({ steps: DONE })).toBe('◦ 3/3 All done')
})

test('errors and the desktop keep the engine tool rows', async ($, on) => {
  world(on)
  const errored = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolUse',
    props: toolRow({ steps: STEPS }, { isErrored: true }),
  })
  expect(await errored.find({ type: 'Text', text: 'engine' })).toBeDefined()

  const desktop = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'ToolUse', props: toolRow({ steps: STEPS }) })
  expect(await desktop.find({ type: 'Text', text: 'engine' })).toBeDefined()
})

test('finishing a plan raises one toast', async ($, on) => {
  world(on)
  const toasts = toastsOf(on)
  await $.tool.call({ tool: TOOL, goal: 'Fix login bug', steps: STEPS })
  await $.tool.call({ tool: TOOL, goal: 'Fix login bug', steps: DONE })
  await $.tool.call({ tool: TOOL, goal: 'Fix login bug', steps: DONE })
  expect(toasts).toEqual(['All 3 steps done · Fix login bug (0s)'])
})

test('the row shows how long the running step has taken', async ($, on) => {
  const clock = world(on)
  turns(on)
  await $.tool.call({ tool: TOOL, goal: 'Fix login bug', steps: STEPS })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.advance(65_000)

  const desktop = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: band(true) })
  expect(await desktop.find({ type: 'Text', text: /^· 1m$/ })).toBeDefined()
  const terminal = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Spinner', props: SPINNER })
  expect(await terminal.find({ type: 'Text', text: '· 1m 5s' })).toBeDefined()
})

test('a finished plan is not redrawn while a turn runs', async ($, on) => {
  const draws = drawsOf(on)
  const clock = world(on)
  turns(on)
  await $.tool.call({ tool: TOOL, goal: 'Fix login bug', steps: DONE })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: band(true) })
  await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Spinner', props: SPINNER })
  const before = [draws.AbovePrompt, draws.Spinner]
  expect(before).toEqual([1, 1])

  await clock.advance(10_000)
  expect([draws.AbovePrompt, draws.Spinner]).toEqual(before)
})

test('a paused band does not follow the clock', async ($, on) => {
  const draws = drawsOf(on)
  const clock = world(on)
  turns(on)
  await $.tool.call({ tool: TOOL, goal: 'Fix login bug', steps: STEPS })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: band(false) })

  await clock.advance(2 * 60_000)
  expect(draws.AbovePrompt).toBe(1)
})

test('the Desktop band redraws for its timer once a minute, the terminal once a second', async ($, on) => {
  const draws = drawsOf(on)
  const clock = world(on)
  turns(on)
  await $.tool.call({ tool: TOOL, goal: 'Fix login bug', steps: STEPS })
  await $.turn.start({ text: 'go', turnId: 't1' })
  const desktop = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: band(true) })
  const terminal = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Spinner', props: SPINNER })

  await clock.advance(59_000)
  expect(draws.AbovePrompt).toBe(1)
  expect(await desktop.find({ type: 'Text', text: /^·/ })).toBeUndefined()
  expect(draws.Spinner).toBe(60)
  expect(await terminal.find({ type: 'Text', text: '· 59s' })).toBeDefined()

  await clock.advance(1_000)
  expect(draws.AbovePrompt).toBe(2)
  expect(await desktop.find({ type: 'Text', text: /^· 1m$/ })).toBeDefined()
})

test('a step running past the threshold raises one stuck alert and turns the timer red', async ($, on) => {
  const clock = world(on)
  const toasts = toastsOf(on)
  turns(on)
  await $.tool.call({ tool: TOOL, goal: 'Fix login bug', steps: STEPS })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.advance(5 * 60_000)
  expect(toasts).toEqual(['"Write the fix" has been running for 5m 0s; it may be stuck'])

  await clock.advance(60_000)
  expect(toasts).toHaveLength(1)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Spinner', props: SPINNER })
  expect(await ui.find({ type: 'Text', text: '· 6m 0s' })).toMatchObject({ props: { color: '#d1453b' } })
})

test('a threshold of 0 turns the stuck alert off', { options: { stuck_minutes: 0 } }, async ($, on) => {
  const clock = world(on)
  const toasts = toastsOf(on)
  turns(on)
  await $.tool.call({ tool: TOOL, steps: STEPS })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.advance(10 * 60_000)
  expect(toasts).toHaveLength(0)
})

test('toast mode never starts a process', async ($, on) => {
  world(on)
  const runs = processesOf(on)
  await $.tool.call({ tool: TOOL, steps: STEPS })
  await $.tool.call({ tool: TOOL, steps: DONE })
  expect(runs).toHaveLength(0)
})

test('system mode sends an escaped desktop notification', { options: { notify: 'system' } }, async ($, on) => {
  world(on)
  const runs = processesOf(on)
  await $.tool.call({ tool: TOOL, goal: 'Say "hi"', steps: STEPS })
  await $.tool.call({ tool: TOOL, goal: 'Say "hi"', steps: DONE })
  expect(runs).toHaveLength(1)
  expect(runs[0]?.[0]).toBe('osascript')
  expect(runs[0]?.[2]).toContain('Say \\"hi\\"')
})

test('system mode falls back to notify-send without osascript', { options: { notify: 'system' } }, async ($, on) => {
  world(on)
  const runs = processesOf(on, ['osascript'])
  await $.tool.call({ tool: TOOL, steps: STEPS })
  await $.tool.call({ tool: TOOL, steps: DONE })
  expect(runs.map(argv => argv[0])).toEqual(['osascript', 'notify-send'])
})

function offered(on: On, tools: string[] = [TOOL]) {
  on('tool.list', () => ({ value: tools.map(name => ({ name, description: '', mcp: true })) }))
  on('tool.call', () => ({ result: {} }))
}

// Runs `count` main-loop actions and returns the reminder context each one carried.
async function reminders($: Engine, count: number, agentId?: string) {
  const seen: (readonly string[] | undefined)[] = []
  for (let i = 0; i < count; i++) {
    const ran = await $.tool.call({ tool: 'Read', file_path: `/tmp/file-${i}`, ...(agentId ? { agentId } : {}) })
    seen.push((ran as { context?: readonly string[] }).context)
  }
  return seen
}

test('a long turn without a report gets one reminder on its fourth action', async ($, on) => {
  world(on)
  turns(on)
  offered(on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const seen = await reminders($, 6)
  expect(seen.map(context => context?.length ?? 0)).toEqual([0, 0, 0, 1, 0, 0])
  expect(seen[3]?.[0]).toContain('with the full plan')
})

test('a turn that reported its plan gets no reminder', async ($, on) => {
  world(on)
  turns(on)
  offered(on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: TOOL, steps: STEPS })
  const seen = await reminders($, 6)
  expect(seen.every(context => context === undefined)).toBe(true)
})

test('an unfinished plan from an earlier turn gets the update reminder', async ($, on) => {
  world(on)
  turns(on)
  offered(on)
  await $.tool.call({ tool: TOOL, steps: STEPS })
  await $.turn.start({ text: 'go on', turnId: 't2' })
  const seen = await reminders($, 4)
  expect(seen[3]?.[0]).toContain('still shows an unfinished plan')
})

test('no reminder when the progress tool is not offered', async ($, on) => {
  world(on)
  turns(on)
  offered(on, ['TodoWrite'])
  await $.turn.start({ text: 'go', turnId: 't1' })
  const seen = await reminders($, 6)
  expect(seen.every(context => context === undefined)).toBe(true)
})

test('subagent actions do not count toward the reminder', async ($, on) => {
  world(on)
  turns(on)
  offered(on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const seen = await reminders($, 6, 'sub-1')
  expect(seen.every(context => context === undefined)).toBe(true)
})

test('fold_reports off keeps the engine rows for progress reports', { options: { fold_reports: false } }, async ($, on) => {
  world(on)
  const row = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'ToolUse', props: toolRow({ steps: STEPS }) })
  expect(await row.find({ type: 'Text', text: 'engine' })).toBeDefined()
  expect(await row.find({ type: 'Text', text: /◦/ })).toBeUndefined()
})

test('language zh labels an English plan in Chinese', { options: { language: 'zh' } }, async ($, on) => {
  world(on)
  await $.tool.call({ tool: TOOL, goal: 'Fix login bug', steps: STEPS })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: band(false) })
  expect(await ui.find({ type: 'Button', key: 'toggle' })).toMatchObject({ text: '查看步骤 ▾' })
})

test('language en labels a Chinese plan in English', { options: { language: 'en' } }, async ($, on) => {
  world(on)
  await $.tool.call({
    tool: TOOL,
    steps: [
      { title: '阅读代码', status: 'completed' },
      { title: '编写修复', status: 'in_progress' },
    ],
  })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: band(false) })
  expect(await ui.find({ type: 'Button', key: 'toggle' })).toMatchObject({ text: 'View steps ▾' })
})

const NOW = 100 * 3_600_000

function seeded(on: On, entries: Record<string, unknown>) {
  mock.clock(on, { now: NOW })
  mock.store(on, entries)
  on('session.id', () => ({ value: 'session-1' }))
}

async function overview($: Engine): Promise<string | undefined> {
  const out = await $.command.run({
    command: 'progress',
    args: 'all',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  return out.text
}

const saved = (steps: unknown, updatedAt: number, cwd?: string) => ({
  goal: '',
  steps,
  source: 'tool',
  updatedAt,
  ...(cwd ? { cwd } : {}),
})

test('/progress all lists recent sessions, newest first, and marks this one', async ($, on) => {
  seeded(on, {
    'plan:session-1': saved(STEPS, NOW - 10_000, '/work/ccprogress'),
    'plan:aaaa1111-0000': saved(STEPS, NOW - 120_000, '/work/ledger'),
    'plan:bbbb2222-0000': saved(DONE, NOW - 2 * 3_600_000),
    'plan:cccc3333-0000': saved(STEPS, NOW - 30 * 3_600_000, '/work/old'),
    'other-key': 1,
  })
  expect(await overview($)).toBe(
    [
      '3 sessions with a plan in the last 24 hours:',
      '● ccprogress · 2/3 Write the fix · just now · this session',
      '● ledger · 2/3 Write the fix · 2m ago',
      '✓ bbbb2222 · all 3 steps done · 2h ago',
    ].join('\n'),
  )
})

test('/progress all says so when no session reported a plan', async ($, on) => {
  seeded(on, { 'plan:old-0000': saved(STEPS, NOW - 48 * 3_600_000) })
  expect(await overview($)).toBe('No session reported a plan in the last 24 hours.')
})

test('/progress all speaks Chinese for Chinese plans', async ($, on) => {
  seeded(on, { 'plan:aaaa1111-0000': saved([{ title: '跑测试', status: 'in_progress' }], NOW - 5 * 60_000, '/work/ledger') })
  expect(await overview($)).toBe(['最近 24 小时有 1 个会话上报了计划：', '● ledger · 1/1 跑测试 · 5 分钟前'].join('\n'))
})

test('a plan records the working directory the session started in', async ($, on) => {
  seeded(on, {})
  on('tool.list', () => ({ value: [] }))
  on('tool.register', () => ({ value: { tool: TOOL } }))
  on('command.register', () => ({ value: { command: 'progress' } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/Users/me/work/ledger', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: TOOL, steps: STEPS })
  expect(await overview($)).toContain('● ledger · 2/3 Write the fix · just now · this session')
})

test('an unknown /progress argument answers with the usage', async ($, on) => {
  world(on)
  await $.tool.call({ tool: TOOL, steps: STEPS })
  const out = await $.command.run({
    command: 'progress',
    args: 'al',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  expect(out.text).toBe('Usage: /progress shows the checklist, /progress all lists every session, /progress clear clears the plan.')
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Spinner', props: SPINNER })
  expect(await ui.find({ type: 'Text', text: 'Write the fix' })).toBeDefined()
})
