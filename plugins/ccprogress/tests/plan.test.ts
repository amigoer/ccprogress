import { describe, expect, test } from 'claude-code/testing'

import { barSvg, phaseIconSvg, stepIconSvg } from '../hooks/icons'
import { barRuns, filled, formatDuration, isCjk, isStuck, stepElapsed, summarize, toSteps, withTiming } from '../hooks/plan'
import type { ProgressPlan, ProgressStep } from '../types'

const PALETTE = { done: '#0f0', current: '#f00' }

const planOf = (steps: ProgressStep[], goal = ''): ProgressPlan => ({ goal, steps, source: 'tool', updatedAt: 0 })

describe('toSteps', () => {
  test('reads titles from title, content or subject', async () => {
    const steps = toSteps([
      { title: 'One', status: 'completed' },
      { content: 'Two', status: 'in_progress' },
      { subject: 'Three' },
    ])
    expect(steps).toEqual([
      { title: 'One', status: 'completed' },
      { title: 'Two', status: 'in_progress' },
      { title: 'Three', status: 'pending' },
    ])
  })

  test('drops entries without a title and tolerates junk', async () => {
    expect(toSteps('nope')).toEqual([])
    expect(toSteps([null, 3, { status: 'completed' }, { title: '  ' }])).toEqual([])
  })
})

describe('summarize', () => {
  test('counts done steps and points at the running one', async () => {
    const s = summarize(
      planOf([
        { title: 'a', status: 'completed' },
        { title: 'b', status: 'pending' },
        { title: 'c', status: 'in_progress' },
      ]),
    )
    expect(s.done).toBe(1)
    expect(s.total).toBe(3)
    expect(s.current?.title).toBe('c')
    expect(s.position).toBe(3)
    expect(s.isComplete).toBe(false)
  })

  test('falls back to the next pending step and reports completion', async () => {
    const pending = summarize(planOf([{ title: 'a', status: 'completed' }, { title: 'b', status: 'pending' }]))
    expect(pending.current?.title).toBe('b')
    expect(pending.position).toBe(2)
    const done = summarize(planOf([{ title: 'a', status: 'completed' }]))
    expect(done.isComplete).toBe(true)
    expect(done.position).toBe(1)
  })
})

describe('bar', () => {
  test('fills in proportion and never overflows', async () => {
    expect(filled(0, 4, 20)).toBe(0)
    expect(filled(1, 4, 20)).toBe(5)
    expect(filled(9, 4, 20)).toBe(20)
    expect(filled(1, 0, 20)).toBe(0)
  })

  test('draws the terminal bar as one continuous line', async () => {
    const runs = barRuns(
      [
        { title: 'a', status: 'completed' },
        { title: 'b', status: 'in_progress' },
        { title: 'c', status: 'pending' },
      ],
      12,
    )
    expect(runs).toEqual([
      { text: '━━━━', tone: 'done' },
      { text: '━━━━', tone: 'current' },
      { text: '━━━━', tone: 'pending' },
    ])
  })

  test('keeps the width for long plans', async () => {
    const steps: ProgressStep[] = Array.from({ length: 20 }, (_, i) => ({
      title: `s${i}`,
      status: i < 10 ? 'completed' : i === 10 ? 'in_progress' : 'pending',
    }))
    const runs = barRuns(steps, 20)
    expect(runs.map(run => run.text).join('')).toHaveLength(20)
    expect(runs.map(run => run.tone)).toEqual(['done', 'current', 'pending'])
  })

  test('draws one SVG segment per step and dims the running one', async () => {
    const steps: ProgressStep[] = [
      { title: 'a', status: 'completed' },
      { title: 'b', status: 'in_progress' },
      { title: 'c', status: 'pending' },
    ]
    const still = barSvg(steps, 90, PALETTE)
    expect(still.match(/<rect /g)).toHaveLength(3)
    expect(still).toContain('fill="#0f0"/>')
    expect(still).toContain('fill="#f00" fill-opacity="0.55"/>')
    expect(still).not.toContain('<animate')
    expect(barSvg(steps, 90, PALETTE, true)).toContain('<animate attributeName="fill-opacity"')
  })
})

describe('icons', () => {
  test('only the working phase and the running step animate', async () => {
    expect(phaseIconSvg('working', PALETTE)).toContain('<animate')
    expect(phaseIconSvg('paused', PALETTE)).not.toContain('<animate')
    expect(stepIconSvg('in_progress', PALETTE, true)).toContain('<animate')
    expect(stepIconSvg('in_progress', PALETTE, false)).not.toContain('<animate')
  })

  test('finished work is drawn in the done color, the rest in the accent or gray', async () => {
    expect(phaseIconSvg('done', PALETTE)).toContain('fill="#0f0"')
    expect(stepIconSvg('completed', PALETTE, false)).toContain('fill="#0f0"')
    expect(stepIconSvg('in_progress', PALETTE, false)).toContain('fill="#f00"')
    expect(stepIconSvg('pending', PALETTE, true)).not.toMatch(/#0f0|#f00/)
  })
})

describe('isCjk', () => {
  test('follows the language of the plan', async () => {
    expect(isCjk(planOf([{ title: '运行测试', status: 'pending' }]))).toBe(true)
    expect(isCjk(planOf([{ title: 'Run tests', status: 'pending' }], '修复登录'))).toBe(true)
    expect(isCjk(planOf([{ title: 'Run tests', status: 'pending' }]))).toBe(false)
    expect(isCjk(null)).toBe(false)
  })
})

describe('timing', () => {
  test('keeps the running step clock across re-sent lists and restarts it on the next step', async () => {
    const first = withTiming(planOf([{ title: 'a', status: 'in_progress' }, { title: 'b', status: 'pending' }]), null, 1000)
    expect(first).toMatchObject({ startedAt: 1000, stepKey: '1:a', stepStartedAt: 1000 })

    const resent = withTiming(planOf([{ title: 'a', status: 'in_progress' }, { title: 'b', status: 'pending' }]), first, 5000)
    expect(resent).toMatchObject({ startedAt: 1000, stepKey: '1:a', stepStartedAt: 1000 })

    const moved = withTiming(planOf([{ title: 'a', status: 'completed' }, { title: 'b', status: 'in_progress' }]), resent, 9000)
    expect(moved).toMatchObject({ startedAt: 1000, stepKey: '2:b', stepStartedAt: 9000 })
  })

  test('a plan after a finished one starts its own clock', async () => {
    const done = withTiming(planOf([{ title: 'a', status: 'completed' }]), null, 1000)
    const fresh = withTiming(planOf([{ title: 'x', status: 'in_progress' }]), done, 20000)
    expect(fresh).toMatchObject({ startedAt: 20000, stepStartedAt: 20000 })
  })

  test('no running step means no step clock', async () => {
    const idle = withTiming(planOf([{ title: 'a', status: 'pending' }]), null, 1000)
    expect(idle.stepKey).toBeUndefined()
    expect(stepElapsed(idle, 99000)).toBeUndefined()
  })

  test('counts as stuck only past a positive threshold', async () => {
    const running = withTiming(planOf([{ title: 'a', status: 'in_progress' }]), null, 0)
    expect(isStuck(running, 299_999, 300_000)).toBe(false)
    expect(isStuck(running, 300_000, 300_000)).toBe(true)
    expect(isStuck(running, 9_000_000, 0)).toBe(false)
  })

  test('formats durations the way the spinner does', async () => {
    expect(formatDuration(45_000)).toBe('45s')
    expect(formatDuration(125_000)).toBe('2m 5s')
    expect(formatDuration(3_720_000)).toBe('1h 2m')
  })
})
