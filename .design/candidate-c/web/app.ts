import { loadCube, toggleKey, setRange, intersect, encodeFilters, decodeFilters } from './cube.ts';
import type { Cube, Filters } from './cube.ts';
import { CHARTS, renderChart, chartDims } from './charts.ts';
import type { Focus, Pick, StackDim } from './charts.ts';
import { evaluateRules } from './rules.ts';
import type { Finding } from './rules.ts';
import { parseSnapshot } from '../shared/snapshot.ts';

export type ViewState = {
  filters: Filters;
  stackBy: StackDim;
};

export type AppState =
  | { phase: 'loading' }
  | { phase: 'empty'; reason: string }
  | { phase: 'ready'; cube: Cube; view: ViewState; findings: readonly Finding[] };

export type Action =
  | { kind: 'snapshotLoaded'; cube: Cube; hash: string }
  | { kind: 'snapshotFailed'; reason: string }
  | { kind: 'pick'; pick: Pick }
  | { kind: 'followEvidence'; finding: Finding }
  | { kind: 'clearFilters' }
  | { kind: 'stackBy'; stackBy: StackDim };

export function reduce(state: AppState, action: Action, now: Date): AppState {
  throw new Error('not implemented');
}

export function applyPick(filters: Filters, pick: Pick): Filters {
  throw new Error('not implemented');
}

export function viewToHash(cube: Cube, view: ViewState): string {
  throw new Error('not implemented');
}

export function viewFromHash(cube: Cube, hash: string): ViewState {
  throw new Error('not implemented');
}

export async function fetchCube(): Promise<{ ok: true; cube: Cube } | { ok: false; reason: string }> {
  throw new Error('not implemented');
}

export async function requestRebuild(): Promise<void> {
  throw new Error('not implemented');
}

export function render(root: HTMLElement, state: AppState, dispatch: (action: Action) => void): void {
  throw new Error('not implemented');
}

export function scrollToFocus(root: HTMLElement, focus: Focus): void {
  throw new Error('not implemented');
}

export async function boot(root: HTMLElement): Promise<void> {
  throw new Error('not implemented');
}
