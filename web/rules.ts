import { resolvePrice, priceRow } from '../shared/prices.ts';
import { SPEEDS, TOKEN_KINDS } from '../shared/snapshot.ts';
import type { TokenKind } from '../shared/snapshot.ts';
import type { Cube, Filters, Selection } from './cube.ts';

export type ChartFocus = 'dailyCost' | 'tokenMix' | 'costByProject' | 'costByModel' | 'cacheHitByWeek' | 'sessionScatter' | 'topSessions' | 'sources';

export const THRESHOLDS = {
  lowCacheHit: { maxHitRate: 0.8, minInputSideTokens: 20_000_000 },
  cacheWriteChurn: { minWriteToReadRatio: 0.12, minWriteCostUsd: 25 },
  premiumShortSessions: { maxHumanTurns: 2, maxRequests: 15, minPremiumCostShare: 0.8, minSessions: 5, minCostUsd: 5 },
  runawaySession: { minCostUsd: 150, minMultipleOfMedian: 10 },
  contextBloat: { minMeanInputSidePerRequest: 320_000, minRequests: 30 },
  outputHeavySession: { minOutputCostShare: 0.3, minCostUsd: 20 },
  premiumShareRising: { minRisePoints: 0.15, baselineWeeks: 3, minLastWeekCostUsd: 20 },
  fastModePremium: { minFastCostShare: 0.15, minFastCostUsd: 10 },
  cacheExpiryRewrites: { idleGapSec: 300, minRewriteTokens: 50_000, minSessionRewriteUsd: 15 },
  pricingGaps: { minUnpricedTokens: 1, maxPlaceholderCostShare: 0.1 },
  cursorEstimatesOnly: { minEstimatedRequestShare: 0.99 },
} as const;

export type RuleId = keyof typeof THRESHOLDS;

export type Severity = 'high' | 'medium' | 'low';

export type Metric = {
  name: string;
  value: number;
  comparator: '<' | '>=' | '>';
  threshold: number;
  unit: 'ratio' | 'usd' | 'tokens' | 'count' | 'points';
};

export type Finding = {
  rule: RuleId;
  title: string;
  severity: Severity;
  subject: string;
  metric: Metric;
  impactUsd: number | null;
  basis: 'measured' | 'estimated';
  advice: string;
  evidence: Filters;
  focus: ChartFocus;
};

export type RuleContext = {
  cube: Cube;
  selection: Selection;
  now: Date;
};

export type Rule = (context: RuleContext) => Finding[];

type SessionStats = {
  key: number;
  cost: number;
  estimatedCost: number;
  requests: number;
  humanTurns: number;
  inputSide: number;
  output: number;
  outputCost: number;
  premiumCost: number;
  downshiftSavings: number;
};

const INPUT_SIDE: readonly TokenKind[] = ['input', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h'];

function inputSide(value: (kind: TokenKind) => number): number {
  return INPUT_SIDE.reduce((sum, kind) => sum + value(kind), 0);
}

function keysFilter(...keys: number[]) {
  return { kind: 'keys' as const, keys: new Set(keys) };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const statsCache = new WeakMap<Selection, SessionStats[]>();

export function sessionStats(cube: Cube, selection: Selection): SessionStats[] {
  const cached = statsCache.get(selection);
  if (cached) return cached;
  const byKey = new Map<number, SessionStats>();
  const vector = {} as Record<TokenKind, number>;
  for (const row of selection.rows()) {
    const key = cube.rowKey(row, 'session');
    const info = cube.session(key);
    if (info.kind !== 'conversation') continue;
    let stats = byKey.get(key);
    if (!stats) {
      stats = { key, cost: 0, estimatedCost: 0, requests: 0, humanTurns: info.humanTurns, inputSide: 0, output: 0, outputCost: 0, premiumCost: 0, downshiftSavings: 0 };
      byKey.set(key, stats);
    }
    const cost = cube.rowValue(row, 'costUsd');
    const model = cube.model(cube.rowKey(row, 'model'));
    stats.cost += cost;
    if (cube.rowKey(row, 'fidelity') !== 0 || model.price.kind !== 'priced' || model.price.entry.source !== 'list') stats.estimatedCost += cost;
    stats.requests += 1;
    for (const kind of TOKEN_KINDS) vector[kind] = cube.rowValue(row, kind);
    stats.inputSide += inputSide((kind) => vector[kind]);
    stats.output += vector.output + vector.reasoning;
    if (model.price.kind === 'priced') {
      const speed = SPEEDS[cube.rowKey(row, 'speed')];
      const outputOnly = { ...vector, input: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, unsplit: 0 };
      stats.outputCost += priceRow(model.price.entry, speed, outputOnly);
      if (model.tier === 'premium') {
        stats.premiumCost += cost;
        const downshift = model.price.entry.downshift ? resolvePrice(model.price.entry.downshift) : null;
        if (downshift?.kind === 'priced') stats.downshiftSavings += cost - priceRow(downshift.entry, 'standard', vector);
      }
    }
  }
  const stats = [...byKey.values()];
  statsCache.set(selection, stats);
  return stats;
}

function sessionLabel(cube: Cube, key: number): string {
  const info = cube.session(key);
  return info.title || info.id;
}

function basisOf(estimated: number, total: number): 'measured' | 'estimated' {
  return estimated > 0 && estimated >= total * 0.01 ? 'estimated' : 'measured';
}

function hitRateOf(read: (kind: TokenKind) => number): { rate: number; side: number } {
  const side = inputSide(read);
  return { rate: side > 0 ? read('cacheRead') / side : 0, side };
}

export const RULES: Readonly<Record<RuleId, Rule>> = {
  lowCacheHit: ({ cube, selection }) => {
    const t = THRESHOLDS.lowCacheHit;
    const byProject = selection.rollup('project');
    return byProject.keys.flatMap((key) => {
      const { rate, side } = hitRateOf((kind) => byProject.value(key, kind, 'measured'));
      if (side < t.minInputSideTokens || rate >= t.maxHitRate) return [];
      const uncached = byProject.value(key, 'input', 'measured') + byProject.value(key, 'cacheWrite5m', 'measured') + byProject.value(key, 'cacheWrite1h', 'measured');
      const project = cube.labels('project')[key];
      return [
        {
          rule: 'lowCacheHit',
          title: 'Low prompt-cache hit rate',
          severity: rate < t.maxHitRate / 2 ? 'high' : 'medium',
          subject: project,
          metric: { name: 'cache read ÷ input-side tokens', value: rate, comparator: '<', threshold: t.maxHitRate, unit: 'ratio' },
          impactUsd: null,
          basis: 'measured',
          advice: `${Math.round(uncached / 1e6)}M input-side tokens in ${project} were not served from cache. Keep system prompts and tool lists stable and avoid editing early context mid-session.`,
          evidence: { project: keysFilter(key) },
          focus: 'cacheHitByWeek',
        },
      ];
    });
  },
  cacheWriteChurn: ({ cube, selection }) => {
    const t = THRESHOLDS.cacheWriteChurn;
    const byProject = selection.rollup('project');
    const byProjectModel = selection.rollup2('project', 'model');
    return byProject.keys.flatMap((key) => {
      const writes = byProject.value(key, 'cacheWrite5m', 'measured') + byProject.value(key, 'cacheWrite1h', 'measured');
      const reads = byProject.value(key, 'cacheRead', 'measured');
      const ratio = reads > 0 ? writes / reads : writes > 0 ? Number.POSITIVE_INFINITY : 0;
      let writeCost = 0;
      for (const model of byProjectModel.inner) {
        const info = cube.model(model);
        if (info.price.kind !== 'priced') continue;
        const rates = info.price.entry.usdPerMTok;
        writeCost +=
          (byProjectModel.value(key, model, 'cacheWrite5m', 'measured') * rates.cacheWrite5m +
            byProjectModel.value(key, model, 'cacheWrite1h', 'measured') * rates.cacheWrite1h) /
          1e6;
      }
      if (ratio < t.minWriteToReadRatio || writeCost < t.minWriteCostUsd) return [];
      const project = cube.labels('project')[key];
      return [
        {
          rule: 'cacheWriteChurn',
          title: 'Cache written but rarely re-read',
          severity: ratio >= t.minWriteToReadRatio * 2 ? 'high' : 'medium',
          subject: project,
          metric: { name: 'cache write ÷ cache read tokens', value: ratio, comparator: '>=', threshold: t.minWriteToReadRatio, unit: 'ratio' },
          impactUsd: writeCost,
          basis: 'measured',
          advice: `Cache writes in ${project} cost $${writeCost.toFixed(2)}. Short sessions and frequently changing context pay the write premium without the read discount.`,
          evidence: { project: keysFilter(key) },
          focus: 'tokenMix',
        },
      ];
    });
  },
  premiumShortSessions: ({ cube, selection }) => {
    const t = THRESHOLDS.premiumShortSessions;
    const short = sessionStats(cube, selection).filter(
      (s) => s.humanTurns <= t.maxHumanTurns && s.requests <= t.maxRequests && s.cost > 0 && s.premiumCost / s.cost >= t.minPremiumCostShare,
    );
    const cost = short.reduce((sum, s) => sum + s.cost, 0);
    if (short.length < t.minSessions || cost < t.minCostUsd) return [];
    const savings = short.reduce((sum, s) => sum + s.downshiftSavings, 0);
    return [
      {
        rule: 'premiumShortSessions',
        title: 'Premium model on short sessions',
        severity: 'medium',
        subject: `${short.length} sessions`,
        metric: { name: `premium sessions with ≤${t.maxHumanTurns} prompts and ≤${t.maxRequests} requests`, value: short.length, comparator: '>=', threshold: t.minSessions, unit: 'count' },
        impactUsd: savings,
        basis: basisOf(short.reduce((sum, s) => sum + s.estimatedCost, 0), cost),
        advice: `These sessions cost $${cost.toFixed(2)}. Running them on claude-sonnet-5 would have cost about $${(cost - savings).toFixed(2)}.`,
        evidence: { session: keysFilter(...short.map((s) => s.key)) },
        focus: 'sessionScatter',
      },
    ];
  },
  runawaySession: ({ cube, selection }) => {
    const t = THRESHOLDS.runawaySession;
    const stats = sessionStats(cube, selection);
    const typical = median(stats.map((s) => s.cost));
    const threshold = Math.max(t.minCostUsd, typical * t.minMultipleOfMedian);
    return stats
      .filter((s) => s.cost >= threshold)
      .sort((a, b) => b.cost - a.cost)
      .map((s) => ({
        rule: 'runawaySession' as const,
        title: 'Runaway session',
        severity: s.cost >= threshold * 2 ? ('high' as const) : ('medium' as const),
        subject: sessionLabel(cube, s.key),
        metric: { name: 'session cost', value: s.cost, comparator: '>=' as const, threshold, unit: 'usd' as const },
        impactUsd: s.cost - typical,
        basis: basisOf(s.estimatedCost, s.cost),
        advice: `${s.requests} requests, ${Math.round(s.cost / Math.max(typical, 0.01))}× the median session ($${typical.toFixed(2)}). Split long tasks into fresh sessions and compact earlier.`,
        evidence: { session: keysFilter(s.key) },
        focus: 'topSessions' as const,
      }));
  },
  contextBloat: ({ cube, selection }) => {
    const t = THRESHOLDS.contextBloat;
    return sessionStats(cube, selection)
      .filter((s) => s.requests >= t.minRequests && s.inputSide / s.requests >= t.minMeanInputSidePerRequest)
      .sort((a, b) => b.inputSide / b.requests - a.inputSide / a.requests)
      .map((s) => ({
        rule: 'contextBloat' as const,
        title: 'Context kept near the limit',
        severity: 'medium' as const,
        subject: sessionLabel(cube, s.key),
        metric: { name: 'mean input-side tokens per request', value: s.inputSide / s.requests, comparator: '>=' as const, threshold: t.minMeanInputSidePerRequest, unit: 'tokens' as const },
        impactUsd: null,
        basis: basisOf(s.estimatedCost, s.cost),
        advice: `Every one of ${s.requests} requests re-sent about ${Math.round(s.inputSide / s.requests / 1000)}k tokens of context. Compact or start fresh once a sub-task is done.`,
        evidence: { session: keysFilter(s.key) },
        focus: 'sessionScatter' as const,
      }));
  },
  outputHeavySession: ({ cube, selection }) => {
    const t = THRESHOLDS.outputHeavySession;
    return sessionStats(cube, selection)
      .filter((s) => s.cost >= t.minCostUsd && s.outputCost / s.cost >= t.minOutputCostShare)
      .sort((a, b) => b.outputCost - a.outputCost)
      .map((s) => ({
        rule: 'outputHeavySession' as const,
        title: 'Output-heavy session',
        severity: 'low' as const,
        subject: sessionLabel(cube, s.key),
        metric: { name: 'output share of session cost', value: s.outputCost / s.cost, comparator: '>=' as const, threshold: t.minOutputCostShare, unit: 'ratio' as const },
        impactUsd: s.outputCost,
        basis: basisOf(s.estimatedCost, s.cost),
        advice: `$${s.outputCost.toFixed(2)} of $${s.cost.toFixed(2)} went to ${Math.round(s.output / 1000)}k generated tokens. Ask for diffs instead of whole files and lower effort for routine edits.`,
        evidence: { session: keysFilter(s.key) },
        focus: 'tokenMix' as const,
      }));
  },
  premiumShareRising: ({ cube, selection, now }) => {
    const t = THRESHOLDS.premiumShareRising;
    const weeks = cube.labels('week');
    const nowDay = now.toISOString().slice(0, 10);
    const lastComplete = weeks.findLastIndex((monday) => {
      const end = new Date(Date.parse(`${monday}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
      return end <= nowDay;
    });
    if (lastComplete < t.baselineWeeks) return [];
    const premium = cube.labels('tier').indexOf('premium');
    const byWeek = selection.without(['week', 'tier']).rollup2('week', 'tier');
    const share = (week: number) => {
      const total = byWeek.inner.reduce((sum, tier) => sum + byWeek.value(week, tier, 'costUsd'), 0);
      return { total, share: total > 0 ? byWeek.value(week, premium, 'costUsd') / total : 0 };
    };
    const last = share(lastComplete);
    const baseline = Array.from({ length: t.baselineWeeks }, (_, index) => share(lastComplete - 1 - index).share);
    const rise = last.share - baseline.reduce((sum, value) => sum + value, 0) / baseline.length;
    if (last.total < t.minLastWeekCostUsd || rise < t.minRisePoints) return [];
    return [
      {
        rule: 'premiumShareRising',
        title: 'Premium-model share rising',
        severity: 'medium',
        subject: `week of ${weeks[lastComplete]}`,
        metric: { name: `premium cost share vs prior ${t.baselineWeeks}-week mean`, value: rise, comparator: '>=', threshold: t.minRisePoints, unit: 'points' },
        impactUsd: null,
        basis: 'measured',
        advice: `Premium models took ${Math.round(last.share * 100)}% of $${last.total.toFixed(2)} last week. Check whether routine work drifted onto premium models.`,
        evidence: { week: { kind: 'range', from: lastComplete - t.baselineWeeks, toExclusive: lastComplete + 1 } },
        focus: 'dailyCost',
      },
    ];
  },
  fastModePremium: ({ cube, selection }) => {
    const t = THRESHOLDS.fastModePremium;
    const bySpeed = selection.rollup('speed');
    const fast = cube.labels('speed').indexOf('fast');
    const fastCost = bySpeed.value(fast, 'costUsd');
    const total = selection.total().value('costUsd');
    const share = total > 0 ? fastCost / total : 0;
    if (fastCost < t.minFastCostUsd || share < t.minFastCostShare) return [];
    return [
      {
        rule: 'fastModePremium',
        title: 'Fast mode premium',
        severity: 'medium',
        subject: 'fast-mode requests',
        metric: { name: 'fast-mode share of cost', value: share, comparator: '>=', threshold: t.minFastCostShare, unit: 'ratio' },
        impactUsd: fastCost / 2,
        basis: basisOf(bySpeed.value(fast, 'costUsd', 'estimated'), fastCost),
        advice: `Fast mode doubles the price. Standard speed would have saved about $${(fastCost / 2).toFixed(2)}.`,
        evidence: { speed: keysFilter(fast) },
        focus: 'costByModel',
      },
    ];
  },
  cacheExpiryRewrites: ({ cube, selection }) => {
    const t = THRESHOLDS.cacheExpiryRewrites;
    const lastSeen = new Map<number, number>();
    const rewrites = new Map<number, { usd: number; count: number }>();
    for (const row of selection.rows()) {
      const session = cube.rowKey(row, 'session');
      const at = cube.rowAtSec(row);
      const previous = lastSeen.get(session);
      lastSeen.set(session, at);
      if (previous === undefined || at - previous < t.idleGapSec) continue;
      const written = cube.rowValue(row, 'cacheWrite5m') + cube.rowValue(row, 'cacheWrite1h');
      if (written < t.minRewriteTokens) continue;
      const model = cube.model(cube.rowKey(row, 'model'));
      if (model.price.kind !== 'priced') continue;
      const rates = model.price.entry.usdPerMTok;
      const usd = (cube.rowValue(row, 'cacheWrite5m') * rates.cacheWrite5m + cube.rowValue(row, 'cacheWrite1h') * rates.cacheWrite1h - written * rates.cacheRead) / 1e6;
      const entry = rewrites.get(session) ?? { usd: 0, count: 0 };
      entry.usd += usd;
      entry.count += 1;
      rewrites.set(session, entry);
    }
    return [...rewrites.entries()]
      .filter(([, entry]) => entry.usd >= t.minSessionRewriteUsd)
      .sort((a, b) => b[1].usd - a[1].usd)
      .map(([session, entry]) => ({
        rule: 'cacheExpiryRewrites' as const,
        title: 'Cache rewritten after idle gaps',
        severity: 'low' as const,
        subject: sessionLabel(cube, session),
        metric: { name: `cache-rewrite cost after >${t.idleGapSec / 60} min idle`, value: entry.usd, comparator: '>=' as const, threshold: t.minSessionRewriteUsd, unit: 'usd' as const },
        impactUsd: entry.usd,
        basis: 'measured' as const,
        advice: `${entry.count} requests re-wrote the whole cache after the 5-minute TTL lapsed. Resume sooner, or use the 1-hour cache for sessions with long pauses.`,
        evidence: { session: keysFilter(session) },
        focus: 'topSessions' as const,
      }));
  },
  pricingGaps: ({ cube, selection }) => {
    const t = THRESHOLDS.pricingGaps;
    const byModel = selection.rollup('model');
    const findings: Finding[] = [];
    const unpriced = byModel.keys.filter((key) => byModel.value(key, 'unpricedTokens') >= t.minUnpricedTokens);
    const unpricedTokens = unpriced.reduce((sum, key) => sum + byModel.value(key, 'unpricedTokens'), 0);
    if (unpriced.length > 0) {
      findings.push({
        rule: 'pricingGaps',
        title: 'Models without a price',
        severity: 'medium',
        subject: unpriced.map((key) => cube.labels('model')[key]).join(', '),
        metric: { name: 'tokens on unpriced models', value: unpricedTokens, comparator: '>=', threshold: t.minUnpricedTokens, unit: 'tokens' },
        impactUsd: null,
        basis: 'measured',
        advice: 'These tokens are excluded from every cost figure. Add the models to PRICE_TABLE in shared/prices.ts.',
        evidence: { model: keysFilter(...unpriced) },
        focus: 'costByModel',
      });
    }
    const placeholder = byModel.keys.filter((key) => {
      const price = cube.model(key).price;
      return price.kind === 'priced' && price.entry.source === 'placeholder' && byModel.value(key, 'costUsd') > 0;
    });
    const placeholderCost = placeholder.reduce((sum, key) => sum + byModel.value(key, 'costUsd'), 0);
    const total = selection.total().value('costUsd');
    const share = total > 0 ? placeholderCost / total : 0;
    if (share > t.maxPlaceholderCostShare) {
      findings.push({
        rule: 'pricingGaps',
        title: 'Cost rests on placeholder prices',
        severity: 'low',
        subject: placeholder.map((key) => cube.labels('model')[key]).join(', '),
        metric: { name: 'placeholder-priced share of cost', value: share, comparator: '>', threshold: t.maxPlaceholderCostShare, unit: 'ratio' },
        impactUsd: placeholderCost,
        basis: 'estimated',
        advice: 'No published price is on file for these models. Replace the placeholder rates in shared/prices.ts.',
        evidence: { model: keysFilter(...placeholder) },
        focus: 'costByModel',
      });
    }
    return findings;
  },
  cursorEstimatesOnly: ({ cube, selection }) => {
    const t = THRESHOLDS.cursorEstimatesOnly;
    const cursor = cube.labels('tool').indexOf('cursor');
    const byTool = selection.rollup('tool');
    const requests = byTool.value(cursor, 'requests');
    if (requests === 0) return [];
    const share = byTool.value(cursor, 'requests', 'estimated') / requests;
    if (share < t.minEstimatedRequestShare) return [];
    return [
      {
        rule: 'cursorEstimatesOnly',
        title: 'Cursor figures are estimates',
        severity: 'low',
        subject: 'cursor',
        metric: { name: 'estimated share of Cursor requests', value: share, comparator: '>=', threshold: t.minEstimatedRequestShare, unit: 'ratio' },
        impactUsd: null,
        basis: 'estimated',
        advice: 'Cursor does not store token counts locally. Export usage from cursor.com/dashboard and drop the CSV in ~/.tokenomics/imports/cursor/, then Rebuild.',
        evidence: { tool: keysFilter(cursor) },
        focus: 'sources',
      },
    ];
  },
};

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export function evaluateRules(context: RuleContext): Finding[] {
  return (Object.keys(RULES) as RuleId[])
    .flatMap((id) => RULES[id](context))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (b.impactUsd ?? 0) - (a.impactUsd ?? 0));
}

export type Distribution = { metric: string; count: number; p50: number; p90: number; p99: number; max: number };

function distribution(metric: string, values: readonly number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);
  return { metric, count: sorted.length, p50: at(0.5), p90: at(0.9), p99: at(0.99), max: sorted.at(-1) ?? 0 };
}

export function ruleDistributions(cube: Cube): Distribution[] {
  const selection = cube.select({});
  const stats = sessionStats(cube, selection);
  const byProject = selection.rollup('project');
  const projectRates = byProject.keys
    .map((key) => hitRateOf((kind) => byProject.value(key, kind, 'measured')))
    .filter((entry) => entry.side >= THRESHOLDS.lowCacheHit.minInputSideTokens);
  const churn = byProject.keys
    .map((key) => {
      const reads = byProject.value(key, 'cacheRead', 'measured');
      return reads > 0 ? (byProject.value(key, 'cacheWrite5m', 'measured') + byProject.value(key, 'cacheWrite1h', 'measured')) / reads : 0;
    })
    .filter((value) => value > 0);
  const typical = median(stats.map((s) => s.cost));
  const byWeek = selection.rollup2('week', 'tier');
  const premium = cube.labels('tier').indexOf('premium');
  const weeklyShare = byWeek.outer
    .map((week) => {
      const total = byWeek.inner.reduce((sum, tier) => sum + byWeek.value(week, tier, 'costUsd'), 0);
      return total > 0 ? byWeek.value(week, premium, 'costUsd') / total : -1;
    })
    .filter((share) => share >= 0);
  const rewriteUsd = RULES.cacheExpiryRewrites({ cube, selection, now: new Date() }).map((finding) => finding.metric.value);
  return [
    distribution('lowCacheHit: project cache hit rate (input side ≥ threshold)', projectRates.map((entry) => entry.rate)),
    distribution('cacheWriteChurn: project cache write ÷ read', churn),
    distribution('runawaySession: session cost USD', stats.map((s) => s.cost)),
    distribution('runawaySession: session cost ÷ median', stats.map((s) => (typical > 0 ? s.cost / typical : 0))),
    distribution('contextBloat: mean input-side per request (≥ min requests)', stats.filter((s) => s.requests >= THRESHOLDS.contextBloat.minRequests).map((s) => s.inputSide / s.requests)),
    distribution('outputHeavySession: output cost share (cost ≥ min)', stats.filter((s) => s.cost >= THRESHOLDS.outputHeavySession.minCostUsd).map((s) => s.outputCost / s.cost)),
    distribution('premiumShortSessions: human turns per session', stats.map((s) => s.humanTurns)),
    distribution('premiumShortSessions: requests per session', stats.map((s) => s.requests)),
    distribution('premiumShareRising: weekly premium cost share', weeklyShare),
    distribution('cacheExpiryRewrites: firing sessions rewrite USD', rewriteUsd),
  ];
}
