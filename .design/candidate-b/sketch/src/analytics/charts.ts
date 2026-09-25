export type Unit = 'usd' | 'tokens' | 'ratio';

export type ChartDef = {
  id: string;
  title: string;
  unit: Unit;
  x: 'bucket' | 'week' | 'category';
  mark: 'stacked_bar' | 'line' | 'horizontal_bar';
  sql: string;
};

export const CHARTS = [
  {
    id: 'cost_by_tool',
    title: 'Cost over time by tool',
    unit: 'usd',
    x: 'bucket',
    mark: 'stacked_bar',
    sql: `SELECT bucket AS x, tool AS series, SUM(cost_usd) AS value, fidelity
          FROM f WHERE cost_usd IS NOT NULL GROUP BY bucket, tool, fidelity`,
  },
  {
    id: 'cost_by_model',
    title: 'Cost over time by model',
    unit: 'usd',
    x: 'bucket',
    mark: 'stacked_bar',
    sql: `SELECT bucket AS x, model_name AS series, SUM(cost_usd) AS value, fidelity
          FROM f WHERE cost_usd IS NOT NULL GROUP BY bucket, model_name, fidelity`,
  },
  {
    id: 'token_mix',
    title: 'Token mix incl. cache',
    unit: 'tokens',
    x: 'bucket',
    mark: 'stacked_bar',
    sql: `SELECT bucket AS x, 'input' AS series, SUM(input_tokens) AS value, fidelity FROM f GROUP BY bucket, fidelity
          UNION ALL SELECT bucket, 'cache_read', SUM(cache_read_tokens), fidelity FROM f GROUP BY bucket, fidelity
          UNION ALL SELECT bucket, 'cache_write', SUM(cache_write_tokens), fidelity FROM f GROUP BY bucket, fidelity
          UNION ALL SELECT bucket, 'output', SUM(output_tokens), fidelity FROM f GROUP BY bucket, fidelity
          UNION ALL SELECT bucket, 'unsplit', SUM(total_tokens), fidelity FROM f WHERE fidelity = 'total_only' GROUP BY bucket, fidelity`,
  },
  {
    id: 'cache_hit_rate',
    title: 'Cache hit rate by tool',
    unit: 'ratio',
    x: 'bucket',
    mark: 'line',
    sql: `SELECT bucket AS x, tool AS series,
                 1.0 * SUM(cache_read_tokens) / NULLIF(SUM(context_tokens), 0) AS value, fidelity
          FROM f WHERE fidelity = 'measured' GROUP BY bucket, tool, fidelity`,
  },
  {
    id: 'cost_by_project',
    title: 'Cost by project',
    unit: 'usd',
    x: 'category',
    mark: 'horizontal_bar',
    sql: `SELECT COALESCE(project_label, '(no project)') AS x, tool AS series, SUM(cost_usd) AS value, fidelity
          FROM f WHERE cost_usd IS NOT NULL GROUP BY x, tool, fidelity`,
  },
  {
    id: 'tier_share_by_week',
    title: 'Cost share by model tier per week',
    unit: 'ratio',
    x: 'week',
    mark: 'stacked_bar',
    sql: `SELECT week AS x, COALESCE(tier, 'unpriced') AS series,
                 SUM(cost_usd) / SUM(SUM(cost_usd)) OVER (PARTITION BY week) AS value, fidelity
          FROM f WHERE cost_usd IS NOT NULL GROUP BY week, series, fidelity`,
  },
] as const satisfies readonly ChartDef[];

export type ChartId = (typeof CHARTS)[number]['id'];

export const SESSION_TABLE_SQL = `
  SELECT session_key, tool, project_label, title, started_ms, ended_ms, requests,
         cost_usd, cache_hit_rate, output_cost_share, models, fidelity_mix
  FROM sess ORDER BY cost_usd DESC NULLS LAST LIMIT :session_limit`;
