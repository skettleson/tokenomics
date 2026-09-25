import type { TokenKind } from '../shared/snapshot.ts';
import type { Cube, Dim, Filter, Measure, OrdinalDim, Selection } from './cube.ts';

export type StackDim = Extract<Dim, 'tool' | 'model' | 'project'>;

export type ChartId = 'costOverTime' | 'tokenMix' | 'costByProject' | 'costByModel' | 'cacheHitByWeek' | 'sessions' | 'fidelity';

export type Focus = { chart: ChartId; stackBy?: StackDim };

export type Value =
  | { kind: 'sum'; measure: Measure }
  | { kind: 'ratio'; numerator: readonly Measure[]; denominator: readonly Measure[] };

export type ChartSpec =
  | { id: ChartId; title: string; mark: 'timeColumns'; x: OrdinalDim; stack: 'viewStackBy'; value: Value }
  | { id: ChartId; title: string; mark: 'kindBars'; y: StackDim; kinds: readonly TokenKind[] }
  | { id: ChartId; title: string; mark: 'rankedBars'; y: Dim; value: Value; top: number }
  | { id: ChartId; title: string; mark: 'timeLines'; x: OrdinalDim; series: StackDim; value: Value }
  | { id: ChartId; title: string; mark: 'sessionTable'; top: number }
  | { id: ChartId; title: string; mark: 'fidelityStrip' };

export const CHARTS: readonly ChartSpec[] = [
  { id: 'costOverTime', title: 'Cost per day', mark: 'timeColumns', x: 'day', stack: 'viewStackBy', value: { kind: 'sum', measure: 'costUsd' } },
  { id: 'tokenMix', title: 'Token mix', mark: 'kindBars', y: 'tool', kinds: ['input', 'cacheWrite5m', 'cacheWrite1h', 'cacheRead', 'output', 'reasoning', 'unsplit'] },
  { id: 'costByProject', title: 'Cost by project', mark: 'rankedBars', y: 'project', value: { kind: 'sum', measure: 'costUsd' }, top: 15 },
  { id: 'costByModel', title: 'Cost by model', mark: 'rankedBars', y: 'model', value: { kind: 'sum', measure: 'costUsd' }, top: 12 },
  {
    id: 'cacheHitByWeek',
    title: 'Cache hit rate by week',
    mark: 'timeLines',
    x: 'week',
    series: 'tool',
    value: { kind: 'ratio', numerator: ['cacheRead'], denominator: ['input', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h'] },
  },
  { id: 'sessions', title: 'Most expensive sessions', mark: 'sessionTable', top: 25 },
  { id: 'fidelity', title: 'Sources and fidelity', mark: 'fidelityStrip' },
];

export type Pick =
  | { kind: 'toggleKey'; dim: Dim; key: number }
  | { kind: 'brush'; dim: OrdinalDim; range: { from: number; toExclusive: number } | null };

export type ChartProps = {
  spec: ChartSpec;
  cube: Cube;
  selection: Selection;
  activeFilter: Filter | undefined;
  stackBy: StackDim;
  onPick: (pick: Pick) => void;
};

export function renderChart(host: HTMLElement, props: ChartProps): void {
  throw new Error('not implemented');
}

export function chartDims(spec: ChartSpec, stackBy: StackDim): readonly Dim[] {
  throw new Error('not implemented');
}
