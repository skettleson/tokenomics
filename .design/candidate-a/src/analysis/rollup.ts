import type { EpochMs, EventLog, ModelId, ModelTier, ProjectKey, SessionKey, Tokens, Tool, UsageEvent } from '../domain.ts'
import type { FilterPatch } from './filter.ts'

export type Dimension = 'tool' | 'model' | 'tier' | 'project' | 'session' | 'agent' | 'speed' | 'fidelity'
export type TimeGrain = 'day' | 'week'

export interface Totals {
  readonly exactTokens: Tokens
  readonly estimatedTokens: Tokens
  readonly exactUsd: number
  readonly estimatedUsd: number
  readonly events: number
  readonly estimatedEvents: number
}

export interface Split {
  readonly exact: number
  readonly estimated: number
}

export type Measure =
  | { readonly kind: 'sum'; readonly id: 'cost' | 'tokens' | 'events'; read(totals: Totals): Split }
  | { readonly kind: 'ratio'; readonly id: 'cacheHitRate' | 'outputCostShare'; read(totals: Totals): number | null }

export type MeasureId = Measure['id']

export const MEASURES: Readonly<Record<MeasureId, Measure>> = {
  cost: { kind: 'sum', id: 'cost', read: notImplemented },
  tokens: { kind: 'sum', id: 'tokens', read: notImplemented },
  events: { kind: 'sum', id: 'events', read: notImplemented },
  cacheHitRate: { kind: 'ratio', id: 'cacheHitRate', read: notImplemented },
  outputCostShare: { kind: 'ratio', id: 'outputCostShare', read: notImplemented },
}

export type Query =
  | { readonly kind: 'dimension'; readonly x: TimeGrain | Dimension; readonly series: Dimension | null; readonly measure: MeasureId; readonly top: number | null }
  | { readonly kind: 'token-mix'; readonly x: TimeGrain | Dimension }

export interface Cell {
  readonly totals: Totals
}

export interface Rollup {
  readonly query: Query
  readonly x: readonly string[]
  readonly series: readonly { readonly key: string; readonly cells: readonly Cell[] }[]
}

export interface SessionSummary {
  readonly key: SessionKey
  readonly tool: Tool
  readonly title: string | null
  readonly project: ProjectKey
  readonly start: EpochMs
  readonly end: EpochMs
  readonly dominantModel: ModelId
  readonly dominantTier: ModelTier
  readonly totals: Totals
  readonly medianInputSide: number
  readonly peakInputSide: number
}

export function rollup(log: EventLog, query: Query): Rollup {
  throw new Error('not implemented')
}

export function totalsOf(events: readonly UsageEvent[]): Totals {
  throw new Error('not implemented')
}

export function summarizeSessions(log: EventLog): readonly SessionSummary[] {
  throw new Error('not implemented')
}

export function bucketStart(at: EpochMs, grain: TimeGrain): EpochMs {
  throw new Error('not implemented')
}

export function patchForPick(query: Query, xKey: string, seriesKey: string | null): FilterPatch {
  throw new Error('not implemented')
}

function notImplemented(): never {
  throw new Error('not implemented')
}
