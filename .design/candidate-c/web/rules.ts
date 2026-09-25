import type { Fidelity } from '../shared/snapshot.ts';
import type { Cube, Filters, Selection } from './cube.ts';
import type { Focus } from './charts.ts';

export const THRESHOLDS = {
  lowCacheHit: { maxHitRate: 0.6, minInputSideTokens: 2_000_000 },
  cacheWriteNotReused: { maxWriteToReadRatio: 0.4, minWriteTokens: 1_000_000 },
  premiumModelShortSessions: { maxHumanTurns: 2, maxRequests: 15, minPremiumCostShare: 0.8, minSessions: 10, minCostUsd: 5 },
  runawaySession: { minCostUsd: 25, minMultipleOfMedian: 5 },
  contextBloat: { minMeanInputSidePerRequest: 150_000, minRequests: 30 },
  outputHeavySession: { minOutputShare: 0.15, minOutputTokens: 150_000 },
  premiumShareRising: { minRisePoints: 0.15, baselineWeeks: 3, minLastWeekCostUsd: 20 },
  pricingGaps: { minUnpricedTokens: 1, minPlaceholderCostShare: 0.1 },
  cursorEstimatesOnly: { minEstimatedRequestShare: 1 },
} as const;

export type RuleId = keyof typeof THRESHOLDS;

export type Severity = 'high' | 'medium' | 'low';

export type Metric = {
  name: string;
  value: number;
  comparator: '<' | '>=';
  threshold: number;
  unit: 'ratio' | 'usd' | 'tokens' | 'count' | 'points';
};

export type Finding = {
  rule: RuleId;
  severity: Severity;
  subject: string;
  metric: Metric;
  impactUsd: number | null;
  basis: Fidelity;
  advice: string;
  evidence: Filters;
  focus: Focus;
};

export type RuleContext = {
  cube: Cube;
  selection: Selection;
  now: Date;
};

export type Rule = (context: RuleContext) => Finding[];

export const RULES: Readonly<Record<RuleId, Rule>> = {
  lowCacheHit: (context) => {
    throw new Error('not implemented');
  },
  cacheWriteNotReused: (context) => {
    throw new Error('not implemented');
  },
  premiumModelShortSessions: (context) => {
    throw new Error('not implemented');
  },
  runawaySession: (context) => {
    throw new Error('not implemented');
  },
  contextBloat: (context) => {
    throw new Error('not implemented');
  },
  outputHeavySession: (context) => {
    throw new Error('not implemented');
  },
  premiumShareRising: (context) => {
    throw new Error('not implemented');
  },
  pricingGaps: (context) => {
    throw new Error('not implemented');
  },
  cursorEstimatesOnly: (context) => {
    throw new Error('not implemented');
  },
};

export function evaluateRules(context: RuleContext): Finding[] {
  throw new Error('not implemented');
}
