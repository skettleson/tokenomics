import { asDay, asSessionKey } from '../domain.ts';
import type { ChartId } from './charts.ts';
import type { FilterPatch } from './filter.ts';

export type SubjectKind = 'project' | 'session' | 'model' | 'tool' | 'global';

export type RuleRow = {
  subject_id: string;
  subject_label: string;
  metric_value: number;
  impact_usd: number | null;
  window_from: string | null;
};

export type Evidence = {
  patch: FilterPatch;
  focus: ChartId | 'sessions';
};

export type RuleDef = {
  id: string;
  subjectKind: SubjectKind;
  metric: { name: string; unit: 'ratio' | 'usd' | 'tokens' | 'count'; comparator: '>=' | '<='; thresholdParam: string };
  params: Record<string, number>;
  requires: 'measured' | 'any';
  impactKind: 'savings_estimate' | 'spend_at_stake' | 'none';
  headline(row: RuleRow): string;
  action: string;
  ctes?: string;
  sql: string;
  evidence(row: RuleRow): Evidence;
};

export const RULES = [
  {
    id: 'low_cache_hit_project',
    subjectKind: 'project',
    metric: { name: 'cache hit rate', unit: 'ratio', comparator: '<=', thresholdParam: 'max_hit_rate' },
    params: { max_hit_rate: 0.7, min_context_tokens: 5_000_000 },
    requires: 'measured',
    impactKind: 'spend_at_stake',
    headline: (r) => `Cache hit rate in ${r.subject_label} is ${Math.round(r.metric_value * 100)}%`,
    action: 'Keep system prompt, CLAUDE.md and tool set stable within a session; avoid switching models mid-session.',
    sql: `SELECT project_id AS subject_id, project_label AS subject_label,
                 1.0 * SUM(cache_read_tokens) / SUM(context_tokens) AS metric_value,
                 SUM(input_tokens * (rate_input - rate_cache_read)) / 1e6 AS impact_usd, NULL AS window_from
          FROM f WHERE project_id IS NOT NULL AND tool IN ('claude_code', 'codex')
          GROUP BY project_id
          HAVING SUM(context_tokens) >= :min_context_tokens AND metric_value <= :max_hit_rate`,
    evidence: (r) => ({ patch: { projects: [Number(r.subject_id)] }, focus: 'cache_hit_rate' }),
  },
  {
    id: 'cache_write_churn_project',
    subjectKind: 'project',
    metric: { name: 'cache writes per cache read', unit: 'ratio', comparator: '>=', thresholdParam: 'min_write_read_ratio' },
    params: { min_write_read_ratio: 0.2, min_write_cost_usd: 5 },
    requires: 'measured',
    impactKind: 'spend_at_stake',
    headline: (r) => `${r.subject_label} rewrites its prompt cache ${r.metric_value.toFixed(2)} tokens per token read`,
    action: 'Cache is being invalidated. Look for idle gaps past the cache TTL, edited context files, or 1h cache writes that are never reread.',
    sql: `SELECT project_id AS subject_id, project_label AS subject_label,
                 1.0 * SUM(cache_write_tokens) / NULLIF(SUM(cache_read_tokens), 0) AS metric_value,
                 SUM(cache_write_5m_tokens * rate_cache_write_5m + cache_write_1h_tokens * rate_cache_write_1h) / 1e6 AS impact_usd,
                 NULL AS window_from
          FROM f WHERE project_id IS NOT NULL
          GROUP BY project_id
          HAVING metric_value >= :min_write_read_ratio AND impact_usd >= :min_write_cost_usd`,
    evidence: (r) => ({ patch: { projects: [Number(r.subject_id)] }, focus: 'token_mix' }),
  },
  {
    id: 'flagship_short_sessions',
    subjectKind: 'project',
    metric: { name: 'short flagship sessions', unit: 'count', comparator: '>=', thresholdParam: 'min_sessions' },
    params: { min_sessions: 5, max_requests: 8, max_output_tokens: 20_000 },
    requires: 'measured',
    impactKind: 'savings_estimate',
    headline: (r) => `${r.metric_value} short sessions in ${r.subject_label} ran on a flagship model`,
    action: 'Default quick questions and small edits to the standard-tier model; reserve the flagship for long agentic work.',
    sql: `SELECT project_id AS subject_id, project_label AS subject_label, COUNT(*) AS metric_value,
                 SUM(cost_usd - downshift_cost_usd) AS impact_usd, NULL AS window_from
          FROM sess
          WHERE top_tier = 'flagship' AND requests <= :max_requests AND output_tokens <= :max_output_tokens
            AND project_id IS NOT NULL
          GROUP BY project_id HAVING metric_value >= :min_sessions`,
    evidence: (r) => ({ patch: { projects: [Number(r.subject_id)] }, focus: 'sessions' }),
  },
  {
    id: 'runaway_session',
    subjectKind: 'session',
    metric: { name: 'cost vs project median session', unit: 'ratio', comparator: '>=', thresholdParam: 'min_ratio' },
    params: { min_ratio: 4, min_cost_usd: 15, min_project_sessions: 5 },
    requires: 'any',
    impactKind: 'spend_at_stake',
    headline: (r) => `Session "${r.subject_label}" cost ${r.metric_value.toFixed(1)}x its project median`,
    action: 'Split long tasks into fresh sessions with a written plan; check for retry loops and repeated failing tool calls.',
    ctes: `ranked AS (
            SELECT project_id, cost_usd,
                   ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY cost_usd) AS rn,
                   COUNT(*) OVER (PARTITION BY project_id) AS n
            FROM sess WHERE cost_usd IS NOT NULL AND project_id IS NOT NULL),
          median AS (
            SELECT project_id, AVG(cost_usd) AS median_cost FROM ranked
            WHERE rn IN ((n + 1) / 2, (n + 2) / 2) AND n >= :min_project_sessions GROUP BY project_id)`,
    sql: `SELECT s.session_key AS subject_id, COALESCE(s.title, s.session_key) AS subject_label,
                 s.cost_usd / m.median_cost AS metric_value, s.cost_usd AS impact_usd, NULL AS window_from
          FROM sess s JOIN median m ON m.project_id = s.project_id
          WHERE s.cost_usd >= :min_cost_usd AND s.cost_usd / m.median_cost >= :min_ratio`,
    evidence: (r) => ({ patch: { sessions: [asSessionKey(r.subject_id)] }, focus: 'token_mix' }),
  },
  {
    id: 'output_heavy_session',
    subjectKind: 'session',
    metric: { name: 'output share of session cost', unit: 'ratio', comparator: '>=', thresholdParam: 'min_output_share' },
    params: { min_output_share: 0.5, min_cost_usd: 2, min_output_tokens: 40_000 },
    requires: 'measured',
    impactKind: 'spend_at_stake',
    headline: (r) => `Output is ${Math.round(r.metric_value * 100)}% of the cost of "${r.subject_label}"`,
    action: 'Ask for diffs instead of whole-file rewrites and lower reasoning effort for mechanical edits.',
    sql: `SELECT session_key AS subject_id, COALESCE(title, session_key) AS subject_label,
                 output_cost_share AS metric_value, output_cost_usd AS impact_usd, NULL AS window_from
          FROM sess
          WHERE cost_usd >= :min_cost_usd AND output_tokens >= :min_output_tokens
            AND output_cost_share >= :min_output_share`,
    evidence: (r) => ({ patch: { sessions: [asSessionKey(r.subject_id)] }, focus: 'token_mix' }),
  },
  {
    id: 'context_bloat_session',
    subjectKind: 'session',
    metric: { name: 'mean context tokens per request', unit: 'tokens', comparator: '>=', thresholdParam: 'min_mean_context' },
    params: { min_mean_context: 150_000, min_requests: 30 },
    requires: 'measured',
    impactKind: 'spend_at_stake',
    headline: (r) => `"${r.subject_label}" averaged ${Math.round(r.metric_value / 1000)}k context tokens per request`,
    action: 'Compact or restart the session once a subtask completes; trim large tool outputs before they enter context.',
    sql: `SELECT session_key AS subject_id, COALESCE(title, session_key) AS subject_label,
                 1.0 * context_tokens / requests AS metric_value, cost_usd AS impact_usd, NULL AS window_from
          FROM sess WHERE requests >= :min_requests AND 1.0 * context_tokens / requests >= :min_mean_context`,
    evidence: (r) => ({ patch: { sessions: [asSessionKey(r.subject_id)] }, focus: 'token_mix' }),
  },
  {
    id: 'flagship_share_rising',
    subjectKind: 'global',
    metric: { name: 'week-over-week change in flagship cost share', unit: 'ratio', comparator: '>=', thresholdParam: 'min_delta' },
    params: { min_delta: 0.15, min_share: 0.5, min_week_cost_usd: 10 },
    requires: 'any',
    impactKind: 'savings_estimate',
    headline: (r) => `Flagship share of spend rose ${Math.round(r.metric_value * 100)} points in week ${r.subject_label}`,
    action: 'Check which projects moved to the flagship model and whether the work there needs it.',
    ctes: `wk AS (
            SELECT week, SUM(cost_usd) AS total,
                   SUM(CASE WHEN tier = 'flagship' THEN cost_usd ELSE 0 END) AS flagship,
                   SUM(CASE WHEN tier = 'flagship' THEN cost_usd - downshift_cost_usd ELSE 0 END) AS downshift_saving,
                   MIN(day) AS first_day
            FROM f WHERE cost_usd IS NOT NULL AND week < :current_week GROUP BY week),
          w AS (
            SELECT week, total, first_day, downshift_saving, flagship / total AS share,
                   LAG(flagship / total) OVER (ORDER BY week) AS prev_share,
                   LAG(first_day) OVER (ORDER BY week) AS prev_first_day
            FROM wk)`,
    sql: `SELECT 'global' AS subject_id, week AS subject_label, share - prev_share AS metric_value,
                 downshift_saving AS impact_usd, prev_first_day AS window_from
          FROM w WHERE week = (SELECT MAX(week) FROM wk)
            AND share - prev_share >= :min_delta AND share >= :min_share AND total >= :min_week_cost_usd`,
    evidence: (r) => ({ patch: r.window_from === null ? {} : { from: asDay(r.window_from) }, focus: 'tier_share_by_week' }),
  },
  {
    id: 'unpriced_model',
    subjectKind: 'model',
    metric: { name: 'tokens with no price', unit: 'tokens', comparator: '>=', thresholdParam: 'min_tokens' },
    params: { min_tokens: 10_000 },
    requires: 'any',
    impactKind: 'none',
    headline: (r) => `${r.subject_label} has ${r.metric_value.toLocaleString()} tokens but no price`,
    action: 'Add a price entry for this model; its spend is excluded from every cost chart until then.',
    sql: `SELECT model_id AS subject_id, model_name AS subject_label, SUM(total_tokens) AS metric_value,
                 NULL AS impact_usd, NULL AS window_from
          FROM f WHERE price_key IS NULL GROUP BY model_id HAVING metric_value >= :min_tokens`,
    evidence: (r) => ({ patch: { models: [Number(r.subject_id)] }, focus: 'token_mix' }),
  },
  {
    id: 'cursor_estimates_only',
    subjectKind: 'tool',
    metric: { name: 'days of Cursor usage with only estimates', unit: 'count', comparator: '>=', thresholdParam: 'min_days' },
    params: { min_days: 3 },
    requires: 'any',
    impactKind: 'none',
    headline: (r) => `${r.metric_value} days of Cursor usage are estimates`,
    action: 'Export the usage CSV from the Cursor dashboard into the imports folder; measured rows replace estimates day by day.',
    sql: `SELECT 'cursor' AS subject_id, 'Cursor' AS subject_label, COUNT(DISTINCT day) AS metric_value,
                 NULL AS impact_usd, NULL AS window_from
          FROM f WHERE tool = 'cursor' AND fidelity = 'estimated' HAVING metric_value >= :min_days`,
    evidence: (r) => ({ patch: { tools: ['cursor'] }, focus: 'cost_by_tool' }),
  },
] as const satisfies readonly RuleDef[];

export type RuleId = (typeof RULES)[number]['id'];
