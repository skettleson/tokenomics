import type { EpochMs, EventLog } from '../domain.ts'
import type { ChartId } from './charts.ts'
import type { FilterPatch } from './filter.ts'
import type { SessionSummary } from './rollup.ts'

export type RuleId =
  | 'low-cache-hit-project'
  | 'cache-expiry-rewrites'
  | 'frontier-model-short-sessions'
  | 'runaway-session'
  | 'context-bloat'
  | 'output-heavy-session'
  | 'frontier-share-rising'
  | 'fast-mode-premium'
  | 'unpriced-or-placeholder-cost'
  | 'cursor-estimates-only'

export type Severity = 'high' | 'medium' | 'low'

export interface Finding {
  readonly rule: RuleId
  readonly severity: Severity
  readonly headline: string
  readonly action: string
  readonly metric: { readonly name: string; readonly value: number; readonly threshold: number; readonly unit: 'ratio' | 'usd' | 'tokens' | 'count' | 'pp' }
  readonly evidence: FilterPatch
  readonly charts: readonly ChartId[]
  readonly savingsUsd: number | null
  readonly basis: 'exact' | 'includes-estimates'
}

export interface RuleContext {
  readonly log: EventLog
  readonly sessions: readonly SessionSummary[]
  readonly now: EpochMs
}

export interface Rule {
  readonly id: RuleId
  readonly title: string
  evaluate(context: RuleContext): readonly Finding[]
}

export const THRESHOLDS = {
  lowCacheHit: { maxHitRate: 0.7, minInputSideTokens: 5_000_000, minEvents: 50, targetHitRate: 0.9 },
  cacheExpiryRewrites: { idleGapMs: 5 * 60_000, minRewriteTokens: 50_000, minRewriteUsd: 5 },
  frontierShortSessions: { maxResponses: 8, maxTotalTokens: 300_000, minSessions: 10, minUsd: 5, repriceTo: 'claude-sonnet-5' },
  runaway: { minUsd: 25, p90Multiple: 3, minResponses: 400 },
  contextBloat: { minResponses: 40, minMedianInputSide: 150_000, healthyInputSide: 60_000 },
  outputHeavy: { minOutputCostShare: 0.5, minSessionUsd: 3 },
  frontierShareRising: { minRisePp: 15, priorWeeks: 3, minLastWeekUsd: 20 },
  fastMode: { minFastCostShare: 0.15, minFastUsd: 10 },
  pricingGaps: { maxPlaceholderCostShare: 0.1 },
  cursorEstimates: { minEstimatedEvents: 1 },
} as const

export const RULES: readonly Rule[] = [
  { id: 'low-cache-hit-project', title: 'Low prompt-cache hit rate', evaluate: lowCacheHitByProject },
  { id: 'cache-expiry-rewrites', title: 'Cache rewritten after idle gaps', evaluate: cacheExpiryRewrites },
  { id: 'frontier-model-short-sessions', title: 'Frontier model on short sessions', evaluate: frontierModelShortSessions },
  { id: 'runaway-session', title: 'Runaway session', evaluate: runawaySessions },
  { id: 'context-bloat', title: 'Context kept near the limit', evaluate: contextBloat },
  { id: 'output-heavy-session', title: 'Output-heavy session', evaluate: outputHeavySessions },
  { id: 'frontier-share-rising', title: 'Frontier-model share rising', evaluate: frontierShareRising },
  { id: 'fast-mode-premium', title: 'Fast-mode premium', evaluate: fastModePremium },
  { id: 'unpriced-or-placeholder-cost', title: 'Cost rests on missing or placeholder prices', evaluate: pricingGaps },
  { id: 'cursor-estimates-only', title: 'Cursor figures are estimates', evaluate: cursorEstimatesOnly },
]

export function recommend(log: EventLog, now: EpochMs): readonly Finding[] {
  throw new Error('not implemented')
}

function lowCacheHitByProject(context: RuleContext): readonly Finding[] {
  throw new Error('not implemented')
}

function cacheExpiryRewrites(context: RuleContext): readonly Finding[] {
  throw new Error('not implemented')
}

function frontierModelShortSessions(context: RuleContext): readonly Finding[] {
  throw new Error('not implemented')
}

function runawaySessions(context: RuleContext): readonly Finding[] {
  throw new Error('not implemented')
}

function contextBloat(context: RuleContext): readonly Finding[] {
  throw new Error('not implemented')
}

function outputHeavySessions(context: RuleContext): readonly Finding[] {
  throw new Error('not implemented')
}

function frontierShareRising(context: RuleContext): readonly Finding[] {
  throw new Error('not implemented')
}

function fastModePremium(context: RuleContext): readonly Finding[] {
  throw new Error('not implemented')
}

function pricingGaps(context: RuleContext): readonly Finding[] {
  throw new Error('not implemented')
}

function cursorEstimatesOnly(context: RuleContext): readonly Finding[] {
  throw new Error('not implemented')
}
