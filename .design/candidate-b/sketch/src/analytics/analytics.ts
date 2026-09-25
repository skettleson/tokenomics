import type { DatabaseSync } from 'node:sqlite';
import type { Day, Fidelity, SessionKey, Tool } from '../domain.ts';
import type { Reader } from '../warehouse/warehouse.ts';
import type { ChartDef, ChartId } from './charts.ts';
import type { Bucket, CompiledFilter, Filter } from './filter.ts';
import type { Evidence, RuleDef, RuleId, SubjectKind } from './rules.ts';

export type ChartRow = {
  x: string;
  series: string;
  value: number;
  fidelity: Fidelity;
};

export type ChartResult = {
  id: ChartId;
  title: string;
  unit: ChartDef['unit'];
  mark: ChartDef['mark'];
  rows: ChartRow[];
};

export type SessionRow = {
  sessionKey: SessionKey;
  tool: Tool;
  project: string | null;
  title: string | null;
  startedAtMs: number;
  endedAtMs: number;
  requests: number;
  costUsd: number | null;
  cacheHitRate: number | null;
  outputCostShare: number | null;
  models: string[];
  fidelityMix: 'measured' | 'includes_estimates';
};

export type Recommendation = {
  ruleId: RuleId;
  headline: string;
  action: string;
  subject: { kind: SubjectKind; id: string; label: string };
  metric: { name: string; value: number; threshold: number; comparator: '>=' | '<='; unit: RuleDef['metric']['unit'] };
  impact: { kind: 'savings_estimate' | 'spend_at_stake'; usd: number } | null;
  basis: 'measured' | 'includes_estimates';
  evidence: Evidence;
};

export type Totals = {
  costUsd: number;
  costUsdEstimated: number;
  tokens: number;
  unpricedTokens: number;
  requests: number;
  sessions: number;
};

export type Dashboard = {
  filter: Filter;
  bucket: Bucket;
  range: { first: Day; last: Day } | null;
  totals: Totals;
  charts: ChartResult[];
  sessions: SessionRow[];
  recommendations: Recommendation[];
};

export type Meta = {
  tools: Tool[];
  projects: { id: number; label: string; path: string }[];
  models: { id: number; name: string; priced: boolean }[];
  range: { first: Day; last: Day } | null;
};

export type Analytics = {
  meta(): Meta;
  dashboard(filter: Filter, nowMs: number): Dashboard;
};

export function createAnalytics(reader: Reader): Analytics {
  throw new Error('not implemented');
}

function withScope(compiled: CompiledFilter, bucket: Bucket, body: string): string {
  throw new Error('not implemented');
}

function runChart(db: DatabaseSync, def: ChartDef, compiled: CompiledFilter, bucket: Bucket): ChartResult {
  throw new Error('not implemented');
}

function runRule(db: DatabaseSync, rule: RuleDef, filter: Filter, bucket: Bucket, currentWeek: string): Recommendation[] {
  throw new Error('not implemented');
}

function rankRecommendations(recs: Recommendation[]): Recommendation[] {
  throw new Error('not implemented');
}

export const SESSION_ROLLUP_SQL = `
  sess AS (
    SELECT session_key, MIN(tool) AS tool, MIN(project_id) AS project_id, MIN(project_label) AS project_label,
           MIN(session_title) AS title, COUNT(*) AS requests, MIN(ts_ms) AS started_ms, MAX(ts_ms) AS ended_ms,
           SUM(cost_usd) AS cost_usd, SUM(output_cost_usd) AS output_cost_usd,
           SUM(downshift_cost_usd) AS downshift_cost_usd,
           SUM(output_cost_usd) / NULLIF(SUM(cost_usd), 0) AS output_cost_share,
           SUM(output_tokens) AS output_tokens, SUM(context_tokens) AS context_tokens,
           SUM(cache_read_tokens) AS cache_read_tokens, SUM(cache_write_tokens) AS cache_write_tokens,
           1.0 * SUM(cache_read_tokens) / NULLIF(SUM(context_tokens), 0) AS cache_hit_rate,
           CASE WHEN SUM(tier = 'flagship') * 2 > COUNT(*) THEN 'flagship' ELSE MIN(tier) END AS top_tier,
           GROUP_CONCAT(DISTINCT model_name) AS models,
           CASE WHEN SUM(fidelity <> 'measured') = 0 THEN 'measured' ELSE 'includes_estimates' END AS fidelity_mix
    FROM f WHERE session_key IS NOT NULL GROUP BY session_key)`;
