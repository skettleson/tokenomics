import type { Query } from './rollup.ts'

export type ChartId =
  | 'cost-over-time'
  | 'token-mix'
  | 'cost-by-project'
  | 'cost-by-model'
  | 'tier-share-weekly'
  | 'cache-hit-by-project'
  | 'sessions'

export type ChartSpec =
  | { readonly id: ChartId; readonly title: string; readonly kind: 'stacked-bars' | 'bars' | 'share'; readonly query: Query }
  | { readonly id: ChartId; readonly title: string; readonly kind: 'sessions-table'; readonly limit: number }

export const CHARTS: readonly ChartSpec[] = [
  { id: 'cost-over-time', title: 'Cost over time by tool', kind: 'stacked-bars', query: { kind: 'dimension', x: 'day', series: 'tool', measure: 'cost', top: null } },
  { id: 'token-mix', title: 'Token mix incl. cache', kind: 'stacked-bars', query: { kind: 'token-mix', x: 'day' } },
  { id: 'cost-by-project', title: 'Cost by project', kind: 'bars', query: { kind: 'dimension', x: 'project', series: 'tool', measure: 'cost', top: 15 } },
  { id: 'cost-by-model', title: 'Cost by model', kind: 'bars', query: { kind: 'dimension', x: 'model', series: null, measure: 'cost', top: 12 } },
  { id: 'tier-share-weekly', title: 'Frontier-model share of cost, weekly', kind: 'share', query: { kind: 'dimension', x: 'week', series: 'tier', measure: 'cost', top: null } },
  { id: 'cache-hit-by-project', title: 'Cache hit rate by project', kind: 'bars', query: { kind: 'dimension', x: 'project', series: null, measure: 'cacheHitRate', top: 15 } },
  { id: 'sessions', title: 'Most expensive sessions', kind: 'sessions-table', limit: 25 },
]
