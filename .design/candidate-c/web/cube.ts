import { TOKEN_KINDS } from '../shared/snapshot.ts';
import type { Fidelity, SessionKind, SnapshotV1, SourceReport, Tool } from '../shared/snapshot.ts';
import type { PriceResolution } from '../shared/prices.ts';

export const DIMENSIONS = ['tool', 'model', 'project', 'session', 'fidelity', 'day', 'week'] as const;
export type Dim = (typeof DIMENSIONS)[number];
export type OrdinalDim = Extract<Dim, 'day' | 'week'>;

export const MEASURES = [...TOKEN_KINDS, 'costUsd', 'unpricedTokens', 'requests'] as const;
export type Measure = (typeof MEASURES)[number];
export type Basis = Fidelity | 'all';

export type Filter =
  | { kind: 'keys'; keys: ReadonlySet<number> }
  | { kind: 'range'; from: number; toExclusive: number };

export type Filters = Readonly<Partial<Record<Dim, Filter>>>;

export type SessionInfo = {
  key: number;
  id: string;
  tool: Tool;
  kind: SessionKind;
  projectKey: number;
  title: string;
  humanTurns: number;
  startSec: number;
  endSec: number;
};

export type ModelInfo = {
  key: number;
  name: string;
  price: PriceResolution;
};

export type Rollup = {
  dim: Dim;
  keys: readonly number[];
  value(key: number, measure: Measure, basis?: Basis): number;
};

export type Rollup2 = {
  dims: readonly [Dim, Dim];
  outer: readonly number[];
  inner: readonly number[];
  value(outer: number, inner: number, measure: Measure, basis?: Basis): number;
};

export type Total = {
  value(measure: Measure, basis?: Basis): number;
};

export type Selection = {
  filters: Filters;
  without(dims: readonly Dim[]): Selection;
  narrow(extra: Filters): Selection;
  total(): Total;
  rollup(dim: Dim): Rollup;
  rollup2(outer: Dim, inner: Dim): Rollup2;
};

export type Cube = {
  builtAt: string;
  sources: readonly SourceReport[];
  labels(dim: Dim): readonly string[];
  session(key: number): SessionInfo;
  model(key: number): ModelInfo;
  select(filters: Filters): Selection;
};

type Columns = {
  rowCount: number;
  dimKeys: Record<Dim, Uint32Array>;
  measures: Record<Measure, Float64Array>;
  tokenBasis: Uint8Array;
  costBasis: Uint8Array;
};

type FailMask = Uint32Array;

export function loadCube(snapshot: SnapshotV1, options: { timeZone: string }): Cube {
  throw new Error('not implemented');
}

function decodeColumns(snapshot: SnapshotV1, timeZone: string): Columns {
  throw new Error('not implemented');
}

function computeFailMask(columns: Columns, filters: Filters): FailMask {
  throw new Error('not implemented');
}

export function toggleKey(filters: Filters, dim: Dim, key: number): Filters {
  throw new Error('not implemented');
}

export function setRange(filters: Filters, dim: OrdinalDim, range: { from: number; toExclusive: number } | null): Filters {
  throw new Error('not implemented');
}

export function intersect(base: Filters, narrowing: Filters): Filters {
  throw new Error('not implemented');
}

export function encodeFilters(cube: Cube, filters: Filters): string {
  throw new Error('not implemented');
}

export function decodeFilters(cube: Cube, encoded: string): Filters {
  throw new Error('not implemented');
}
