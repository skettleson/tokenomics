import { AGENTS, FIDELITIES, SESSION_KINDS, SPEEDS, TOKEN_KINDS, TOOLS } from '../shared/snapshot.ts';
import type { Fidelity, SessionKind, SnapshotV1, SourceReport, TokenKind, Tool } from '../shared/snapshot.ts';
import { MODEL_TIERS, PRICE_TABLE, priceRow, resolvePrice, tierOf } from '../shared/prices.ts';
import type { ModelTier, PriceEntry, PriceResolution } from '../shared/prices.ts';

export const DIMENSIONS = ['tool', 'model', 'project', 'session', 'fidelity', 'agent', 'tier', 'speed', 'day', 'week'] as const;
export type Dim = (typeof DIMENSIONS)[number];
export type OrdinalDim = Extract<Dim, 'day' | 'week'>;
const ORDINAL_DIMS: ReadonlySet<Dim> = new Set<Dim>(['day', 'week']);

export const MEASURES = [...TOKEN_KINDS, 'costUsd', 'unpricedTokens', 'requests'] as const;
export type Measure = (typeof MEASURES)[number];
export const BASES = ['measured', 'estimated'] as const;
export type Basis = (typeof BASES)[number] | 'all';

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
  tier: ModelTier;
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
  ignored: readonly Dim[];
  without(dims: readonly Dim[]): Selection;
  narrow(extra: Filters): Selection;
  total(): Total;
  rollup(dim: Dim): Rollup;
  rollup2(outer: Dim, inner: Dim): Rollup2;
  rows(): Uint32Array;
};

export type Cube = {
  builtAt: string;
  sources: readonly SourceReport[];
  rowCount: number;
  labels(dim: Dim): readonly string[];
  session(key: number): SessionInfo;
  model(key: number): ModelInfo;
  rowKey(row: number, dim: Dim): number;
  rowValue(row: number, measure: Measure): number;
  rowAtSec(row: number): number;
  select(filters: Filters): Selection;
};

type Columns = {
  rowCount: number;
  atSec: Float64Array;
  dimKeys: Record<Dim, Uint32Array>;
  measures: Record<Measure, Float64Array>;
  tokenBasis: Uint8Array;
  costBasis: Uint8Array;
};

type FailMask = Uint32Array;

const MEASURE_COUNT = MEASURES.length;
const MEASURE_INDEX = Object.fromEntries(MEASURES.map((measure, index) => [measure, index])) as Record<Measure, number>;
const COST_MEASURES: ReadonlySet<Measure> = new Set<Measure>(['costUsd']);
const DIM_BIT = Object.fromEntries(DIMENSIONS.map((dim, index) => [dim, 1 << index])) as Record<Dim, number>;
const DAY_SECONDS = 86_400;

function epochDayOf(label: string): number {
  return Math.round(Date.UTC(Number(label.slice(0, 4)), Number(label.slice(5, 7)) - 1, Number(label.slice(8, 10))) / (DAY_SECONDS * 1000));
}

function labelOfEpochDay(epochDay: number): string {
  return new Date(epochDay * DAY_SECONDS * 1000).toISOString().slice(0, 10);
}

function mondayOf(epochDay: number): number {
  return epochDay - ((epochDay + 3) % 7);
}

function localEpochDays(atSec: readonly number[], timeZone: string): Int32Array {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const byQuarterHour = new Map<number, number>();
  const days = new Int32Array(atSec.length);
  for (let row = 0; row < atSec.length; row++) {
    const bucket = Math.floor(atSec[row] / 900);
    let day = byQuarterHour.get(bucket);
    if (day === undefined) {
      day = epochDayOf(format.format(new Date(bucket * 900_000)));
      byQuarterHour.set(bucket, day);
    }
    days[row] = day;
  }
  return days;
}

function isCostMeasured(fidelity: Fidelity, reported: number | null, price: PriceResolution): boolean {
  if (fidelity !== 'measured') return false;
  return reported !== null || (price.kind === 'priced' && price.entry.source === 'list');
}

export function loadCube(snapshot: SnapshotV1, options: { timeZone: string; priceTable?: readonly PriceEntry[] }): Cube {
  const priceTable = options.priceTable ?? PRICE_TABLE;
  const models: ModelInfo[] = snapshot.models.map((name, key) => {
    const price = resolvePrice(name, priceTable);
    return { key, name, price, tier: tierOf(price) };
  });
  const requests = snapshot.requests;
  const rowCount = requests.atSec.length;
  const epochDays = localEpochDays(requests.atSec, options.timeZone);
  let firstDay = Number.POSITIVE_INFINITY;
  let lastDay = Number.NEGATIVE_INFINITY;
  for (const day of epochDays) {
    if (day < firstDay) firstDay = day;
    if (day > lastDay) lastDay = day;
  }
  if (rowCount === 0) {
    firstDay = 0;
    lastDay = -1;
  }
  const firstMonday = mondayOf(firstDay);
  const dayLabels: string[] = [];
  for (let day = firstDay; day <= lastDay; day++) dayLabels.push(labelOfEpochDay(day));
  const weekLabels: string[] = [];
  for (let monday = firstMonday; monday <= lastDay; monday += 7) weekLabels.push(labelOfEpochDay(monday));

  const dimKeys = Object.fromEntries(DIMENSIONS.map((dim) => [dim, new Uint32Array(rowCount)])) as Record<Dim, Uint32Array>;
  const measures = Object.fromEntries(MEASURES.map((measure) => [measure, new Float64Array(rowCount)])) as Record<Measure, Float64Array>;
  const tokenBasis = new Uint8Array(rowCount);
  const costBasis = new Uint8Array(rowCount);
  const atSec = Float64Array.from(requests.atSec);
  const tokenVector = {} as Record<TokenKind, number>;
  const sessionBounds = snapshot.sessions.id.map(() => ({ startSec: Number.POSITIVE_INFINITY, endSec: Number.NEGATIVE_INFINITY }));
  for (let row = 0; row < rowCount; row++) {
    const session = requests.session[row];
    const model = models[requests.model[row]];
    const fidelity = FIDELITIES[requests.fidelity[row]];
    const reported = requests.reportedCostMicroUsd[row];
    dimKeys.tool[row] = snapshot.sessions.tool[session];
    dimKeys.model[row] = model.key;
    dimKeys.project[row] = snapshot.sessions.project[session];
    dimKeys.session[row] = session;
    dimKeys.fidelity[row] = requests.fidelity[row];
    dimKeys.agent[row] = requests.agent[row];
    dimKeys.tier[row] = MODEL_TIERS.indexOf(model.tier);
    dimKeys.speed[row] = requests.speed[row];
    dimKeys.day[row] = epochDays[row] - firstDay;
    dimKeys.week[row] = (mondayOf(epochDays[row]) - firstMonday) / 7;
    let rowTokens = 0;
    for (const kind of TOKEN_KINDS) {
      const value = requests.tokens[kind][row];
      measures[kind][row] = value;
      tokenVector[kind] = value;
      rowTokens += value;
    }
    measures.requests[row] = 1;
    if (reported !== null) {
      measures.costUsd[row] = reported / 1_000_000;
    } else if (model.price.kind === 'priced') {
      measures.costUsd[row] = priceRow(model.price.entry, SPEEDS[requests.speed[row]], tokenVector);
    } else {
      measures.unpricedTokens[row] = rowTokens;
    }
    tokenBasis[row] = fidelity === 'estimated' ? 1 : 0;
    costBasis[row] = isCostMeasured(fidelity, reported, model.price) ? 0 : 1;
    const bounds = sessionBounds[session];
    if (atSec[row] < bounds.startSec) bounds.startSec = atSec[row];
    if (atSec[row] > bounds.endSec) bounds.endSec = atSec[row];
  }
  const columns: Columns = { rowCount, atSec, dimKeys, measures, tokenBasis, costBasis };
  const sessions: SessionInfo[] = snapshot.sessions.id.map((id, key) => ({
    key,
    id,
    tool: TOOLS[snapshot.sessions.tool[key]],
    kind: SESSION_KINDS[snapshot.sessions.kind[key]],
    projectKey: snapshot.sessions.project[key],
    title: snapshot.sessions.title[key],
    humanTurns: snapshot.sessions.humanTurns[key],
    startSec: sessionBounds[key].startSec,
    endSec: sessionBounds[key].endSec,
  }));
  const labels: Record<Dim, readonly string[]> = {
    tool: TOOLS,
    model: snapshot.models,
    project: snapshot.projects,
    session: snapshot.sessions.id,
    fidelity: FIDELITIES,
    agent: AGENTS,
    tier: MODEL_TIERS,
    speed: SPEEDS,
    day: dayLabels,
    week: weekLabels,
  };
  const cube: Cube = {
    builtAt: snapshot.builtAt,
    sources: snapshot.sources,
    rowCount,
    labels: (dim) => labels[dim],
    session: (key) => sessions[key],
    model: (key) => models[key],
    rowKey: (row, dim) => dimKeys[dim][row],
    rowValue: (row, measure) => measures[measure][row],
    rowAtSec: (row) => atSec[row],
    select: (filters) => createSelection(cube, columns, filters, computeFailMask(columns, filters), []),
  };
  return cube;
}

function computeFailMask(columns: Columns, filters: Filters): FailMask {
  const mask = new Uint32Array(columns.rowCount);
  for (const dim of DIMENSIONS) {
    const filter = filters[dim];
    if (!filter) continue;
    const keys = columns.dimKeys[dim];
    const bit = DIM_BIT[dim];
    if (filter.kind === 'keys') {
      for (let row = 0; row < columns.rowCount; row++) if (!filter.keys.has(keys[row])) mask[row] |= bit;
    } else {
      for (let row = 0; row < columns.rowCount; row++) if (keys[row] < filter.from || keys[row] >= filter.toExclusive) mask[row] |= bit;
    }
  }
  return mask;
}

function basisOffset(measure: Measure, columns: Columns, row: number): number {
  return COST_MEASURES.has(measure) ? columns.costBasis[row] : columns.tokenBasis[row];
}

function accumulate(target: Float64Array, offset: number, columns: Columns, row: number): void {
  for (let index = 0; index < MEASURE_COUNT; index++) {
    const measure = MEASURES[index];
    target[offset + index * 2 + basisOffset(measure, columns, row)] += columns.measures[measure][row];
  }
}

function read(target: Float64Array, offset: number, measure: Measure, basis: Basis): number {
  const index = offset + MEASURE_INDEX[measure] * 2;
  if (basis === 'measured') return target[index];
  if (basis === 'estimated') return target[index + 1];
  return target[index] + target[index + 1];
}

function orderedKeys(dim: Dim, keyCount: number, sums: Float64Array, present: Uint8Array): number[] {
  const keys: number[] = [];
  for (let key = 0; key < keyCount; key++) if (ORDINAL_DIMS.has(dim) || present[key]) keys.push(key);
  if (!ORDINAL_DIMS.has(dim)) keys.sort((a, b) => read(sums, b * MEASURE_COUNT * 2, 'costUsd', 'all') - read(sums, a * MEASURE_COUNT * 2, 'costUsd', 'all') || a - b);
  return keys;
}

function createSelection(cube: Cube, columns: Columns, filters: Filters, mask: FailMask, ignored: readonly Dim[]): Selection {
  let ignoredBits = 0;
  for (const dim of ignored) ignoredBits |= DIM_BIT[dim];
  const passing = (row: number) => (mask[row] & ~ignoredBits) === 0;
  const stride = MEASURE_COUNT * 2;
  return {
    filters,
    ignored,
    without: (dims) => createSelection(cube, columns, filters, mask, [...new Set([...ignored, ...dims])]),
    narrow: (extra) => {
      const combined = intersect(filters, extra);
      return createSelection(cube, columns, combined, computeFailMask(columns, combined), ignored);
    },
    rows: () => {
      const rows: number[] = [];
      for (let row = 0; row < columns.rowCount; row++) if (passing(row)) rows.push(row);
      return Uint32Array.from(rows);
    },
    total: () => {
      const sums = new Float64Array(stride);
      for (let row = 0; row < columns.rowCount; row++) if (passing(row)) accumulate(sums, 0, columns, row);
      return { value: (measure, basis = 'all') => read(sums, 0, measure, basis) };
    },
    rollup: (dim) => {
      const keyCount = cube.labels(dim).length;
      const sums = new Float64Array(keyCount * stride);
      const present = new Uint8Array(keyCount);
      const keyColumn = columns.dimKeys[dim];
      for (let row = 0; row < columns.rowCount; row++) {
        if (!passing(row)) continue;
        const key = keyColumn[row];
        present[key] = 1;
        accumulate(sums, key * stride, columns, row);
      }
      return {
        dim,
        keys: orderedKeys(dim, keyCount, sums, present),
        value: (key, measure, basis = 'all') => (key >= 0 && key < keyCount ? read(sums, key * stride, measure, basis) : 0),
      };
    },
    rollup2: (outerDim, innerDim) => {
      const outerCount = cube.labels(outerDim).length;
      const innerCount = cube.labels(innerDim).length;
      const cells = new Map<number, Float64Array>();
      const outerSums = new Float64Array(outerCount * stride);
      const innerSums = new Float64Array(innerCount * stride);
      const outerPresent = new Uint8Array(outerCount);
      const innerPresent = new Uint8Array(innerCount);
      const outerColumn = columns.dimKeys[outerDim];
      const innerColumn = columns.dimKeys[innerDim];
      for (let row = 0; row < columns.rowCount; row++) {
        if (!passing(row)) continue;
        const outer = outerColumn[row];
        const inner = innerColumn[row];
        const cellKey = outer * innerCount + inner;
        let cell = cells.get(cellKey);
        if (!cell) {
          cell = new Float64Array(stride);
          cells.set(cellKey, cell);
        }
        accumulate(cell, 0, columns, row);
        accumulate(outerSums, outer * stride, columns, row);
        accumulate(innerSums, inner * stride, columns, row);
        outerPresent[outer] = 1;
        innerPresent[inner] = 1;
      }
      return {
        dims: [outerDim, innerDim],
        outer: orderedKeys(outerDim, outerCount, outerSums, outerPresent),
        inner: orderedKeys(innerDim, innerCount, innerSums, innerPresent),
        value: (outer, inner, measure, basis = 'all') => {
          const cell = cells.get(outer * innerCount + inner);
          return cell ? read(cell, 0, measure, basis) : 0;
        },
      };
    },
  };
}

function withFilter(filters: Filters, dim: Dim, filter: Filter | null): Filters {
  const next: Partial<Record<Dim, Filter>> = { ...filters };
  if (filter) next[dim] = filter;
  else delete next[dim];
  return next;
}

export function toggleKey(filters: Filters, dim: Dim, key: number): Filters {
  const current = filters[dim];
  const keys = new Set(current?.kind === 'keys' ? current.keys : []);
  if (keys.has(key)) keys.delete(key);
  else keys.add(key);
  return withFilter(filters, dim, keys.size > 0 ? { kind: 'keys', keys } : null);
}

export function setRange(filters: Filters, dim: OrdinalDim, range: { from: number; toExclusive: number } | null): Filters {
  return withFilter(filters, dim, range && range.toExclusive > range.from ? { kind: 'range', ...range } : null);
}

function intersectFilter(a: Filter, b: Filter): Filter {
  if (a.kind === 'range' && b.kind === 'range') {
    const from = Math.max(a.from, b.from);
    return { kind: 'range', from, toExclusive: Math.max(from, Math.min(a.toExclusive, b.toExclusive)) };
  }
  if (a.kind === 'keys' && b.kind === 'keys') return { kind: 'keys', keys: new Set([...a.keys].filter((key) => b.keys.has(key))) };
  const keys = a.kind === 'keys' ? a : (b as Extract<Filter, { kind: 'keys' }>);
  const range = a.kind === 'range' ? a : (b as Extract<Filter, { kind: 'range' }>);
  return { kind: 'keys', keys: new Set([...keys.keys].filter((key) => key >= range.from && key < range.toExclusive)) };
}

export function intersect(base: Filters, narrowing: Filters): Filters {
  const next: Partial<Record<Dim, Filter>> = { ...base };
  for (const dim of DIMENSIONS) {
    const extra = narrowing[dim];
    if (!extra) continue;
    const current = base[dim];
    next[dim] = current ? intersectFilter(current, extra) : extra;
  }
  return next;
}

export function unionFilters(filters: readonly Filters[]): Filters | null {
  if (filters.length === 0) return null;
  const dims = DIMENSIONS.filter((dim) => filters[0][dim]);
  const union: Partial<Record<Dim, Filter>> = {};
  for (const dim of dims) {
    const keys = new Set<number>();
    for (const each of filters) {
      const filter = each[dim];
      if (filter?.kind !== 'keys') return null;
      for (const key of filter.keys) keys.add(key);
    }
    union[dim] = { kind: 'keys', keys };
  }
  return filters.every((each) => DIMENSIONS.filter((dim) => each[dim]).length === dims.length) ? union : null;
}

export function overlay(base: Filters, replacing: Filters): Filters {
  return { ...base, ...replacing };
}

export function encodeFilters(cube: Cube, filters: Filters): string {
  const parts: string[] = [];
  for (const dim of DIMENSIONS) {
    const filter = filters[dim];
    if (!filter) continue;
    const labels = cube.labels(dim);
    const value =
      filter.kind === 'keys'
        ? [...filter.keys].sort((a, b) => a - b).map((key) => encodeURIComponent(labels[key] ?? '')).join(',')
        : `${encodeURIComponent(labels[filter.from] ?? '')}..${encodeURIComponent(labels[filter.toExclusive - 1] ?? '')}`;
    parts.push(`${dim}=${value}`);
  }
  return parts.join('&');
}

function isDim(name: string): name is Dim {
  return (DIMENSIONS as readonly string[]).includes(name);
}

export function decodeFilters(cube: Cube, encoded: string): Filters {
  let filters: Filters = {};
  for (const part of encoded.replace(/^#/, '').split('&')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const dim = part.slice(0, separator);
    if (!isDim(dim)) continue;
    const labels = cube.labels(dim);
    const value = part.slice(separator + 1);
    const range = value.split('..');
    if (ORDINAL_DIMS.has(dim) && range.length === 2) {
      const from = labels.indexOf(decodeURIComponent(range[0]));
      const to = labels.indexOf(decodeURIComponent(range[1]));
      if (from >= 0 && to >= from) filters = withFilter(filters, dim, { kind: 'range', from, toExclusive: to + 1 });
      continue;
    }
    const keys = new Set(value.split(',').map((label) => labels.indexOf(decodeURIComponent(label))).filter((key) => key >= 0));
    if (keys.size > 0) filters = withFilter(filters, dim, { kind: 'keys', keys });
  }
  return filters;
}
