import type { Rollup, SessionSummary } from '../analysis/rollup.ts'
import type { FilterPatch } from '../analysis/filter.ts'

export type OnPick = (patch: FilterPatch) => void

export function drawStackedBars(host: Element, data: Rollup, onPick: OnPick): void {
  throw new Error('not implemented')
}

export function drawBars(host: Element, data: Rollup, onPick: OnPick): void {
  throw new Error('not implemented')
}

export function drawShare(host: Element, data: Rollup, onPick: OnPick): void {
  throw new Error('not implemented')
}

export function drawSessionsTable(host: Element, sessions: readonly SessionSummary[], onPick: OnPick): void {
  throw new Error('not implemented')
}
