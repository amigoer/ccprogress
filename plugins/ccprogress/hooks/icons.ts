import type { ProgressStatus, ProgressStep } from '../types'
import { MAX_SEGMENTS } from './plan'

// Where the whole plan stands: running in this turn, stopped between turns, or finished.
export type Phase = 'working' | 'paused' | 'done'

// Finished work reads green; the step under way keeps the accent.
export type Palette = { done: string; current: string }

// Translucent grays read on light and dark themes alike.
const TRACK = 'rgba(127,127,127,0.22)'
const RING = 'rgba(127,127,127,0.55)'
const BREATHE = 'values="0.3;0.85;0.3" dur="1.6s" repeatCount="indefinite"'

function svg(size: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16">${body}</svg>`
}

const check = (color: string) =>
  `<circle cx="8" cy="8" r="7" fill="${color}"/>` +
  '<path d="M4.9 8.2 7 10.3 11.2 5.9" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'

const pulse = (color: string, isAnimated: boolean) =>
  `<circle cx="8" cy="8" r="3.5" fill="${color}"/>` +
  (isAnimated
    ? `<circle cx="8" cy="8" r="3.5" fill="none" stroke="${color}" stroke-width="1.4">` +
      '<animate attributeName="r" values="3.5;7.2" dur="1.6s" repeatCount="indefinite"/>' +
      '<animate attributeName="stroke-opacity" values="0.7;0" dur="1.6s" repeatCount="indefinite"/></circle>'
    : `<circle cx="8" cy="8" r="6" fill="none" stroke="${color}" stroke-width="1.4" stroke-opacity="0.35"/>`)

export function phaseIconSvg(phase: Phase, palette: Palette, size = 16): string {
  if (phase === 'done') return svg(size, check(palette.done))
  if (phase === 'working') return svg(size, pulse(palette.current, true))
  return svg(
    size,
    `<circle cx="8" cy="8" r="6" fill="none" stroke="${palette.current}" stroke-width="1.6" stroke-opacity="0.6"/>` +
      `<circle cx="8" cy="8" r="2.2" fill="${palette.current}" fill-opacity="0.6"/>`,
  )
}

export function stepIconSvg(status: ProgressStatus, palette: Palette, isAnimated: boolean, size = 14): string {
  if (status === 'completed') return svg(size, check(palette.done))
  if (status === 'in_progress') return svg(size, pulse(palette.current, isAnimated))
  return svg(size, `<circle cx="8" cy="8" r="5.5" fill="none" stroke="${RING}" stroke-width="1.4"/>`)
}

export function svgWidth(total: number): number {
  return Math.max(72, Math.min(132, total * 22))
}

// Desktop bar: one segment per step; the running one breathes while a turn runs. It
// stretches to the box it is drawn in, so a narrow band can squeeze it.
export function barSvg(steps: readonly ProgressStep[], width: number, palette: Palette, isAnimated = false): string {
  const n = steps.length
  const height = 4
  const radius = 2
  const current = (attrs: string) =>
    isAnimated
      ? `<rect ${attrs} fill="${palette.current}" fill-opacity="0.55"><animate attributeName="fill-opacity" ${BREATHE}/></rect>`
      : `<rect ${attrs} fill="${palette.current}" fill-opacity="0.55"/>`
  let shapes = ''
  if (n > 0 && n <= MAX_SEGMENTS) {
    const gap = 4
    const segment = (width - gap * (n - 1)) / n
    shapes = steps
      .map((step, i) => {
        const attrs = `x="${((segment + gap) * i).toFixed(2)}" width="${segment.toFixed(2)}" height="${height}" rx="${radius}"`
        if (step.status === 'completed') return `<rect ${attrs} fill="${palette.done}"/>`
        if (step.status === 'in_progress') return current(attrs)
        return `<rect ${attrs} fill="${TRACK}"/>`
      })
      .join('')
  } else if (n > 0) {
    const done = (steps.filter(s => s.status === 'completed').length / n) * width
    const running = steps.some(s => s.status === 'in_progress') ? Math.min(width - done, width / n) : 0
    shapes =
      `<rect width="${width}" height="${height}" rx="${radius}" fill="${TRACK}"/>` +
      (running > 0 ? current(`width="${(done + running).toFixed(2)}" height="${height}" rx="${radius}"`) : '') +
      (done > 0 ? `<rect width="${done.toFixed(2)}" height="${height}" rx="${radius}" fill="${palette.done}"/>` : '')
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${shapes}</svg>`
}
