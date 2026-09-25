import { decodeFilters, DIMENSIONS, encodeFilters, loadCube, overlay, setRange, toggleKey } from './cube.ts';
import type { Cube, Dim, Filter, Filters } from './cube.ts';
import { CHARTS, formatCount, formatPercent, formatUsd, STACK_DIMS } from './charts.ts';
import type { ChartId, Pick, StackDim, TableView, Tooltip, TooltipRow } from './charts.ts';
import { evaluateRules } from './rules.ts';
import type { Finding, Metric } from './rules.ts';
import { parseSnapshot } from '../shared/snapshot.ts';

export type ViewState = {
  filters: Filters;
  stackBy: StackDim;
};

export type AppState =
  | { phase: 'loading' }
  | { phase: 'failed'; reason: string }
  | { phase: 'ready'; cube: Cube; view: ViewState; tables: ReadonlySet<ChartId>; focus: ChartId | null; rebuilding: boolean };

export type Action =
  | { kind: 'snapshotLoaded'; cube: Cube; hash: string }
  | { kind: 'snapshotFailed'; reason: string }
  | { kind: 'hashChanged'; hash: string }
  | { kind: 'pick'; pick: Pick }
  | { kind: 'followEvidence'; finding: Finding }
  | { kind: 'removeFilter'; dim: Dim }
  | { kind: 'clearFilters' }
  | { kind: 'setDayRange'; lastDays: number | null }
  | { kind: 'stackBy'; stackBy: StackDim }
  | { kind: 'toggleTable'; chart: ChartId }
  | { kind: 'rebuildStarted' };

function withView(state: AppState, update: (view: ViewState) => ViewState, focus: ChartId | null = null): AppState {
  if (state.phase !== 'ready') return state;
  return { ...state, view: update(state.view), focus };
}

function withoutDim(filters: Filters, dim: Dim): Filters {
  const next: Partial<Record<Dim, Filter>> = { ...filters };
  delete next[dim];
  return next;
}

function lastDaysRange(cube: Cube, lastDays: number, now: Date): { from: number; toExclusive: number } {
  const labels = cube.labels('day');
  const today = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const first = labels.length ? Date.parse(`${labels[0]}T00:00:00Z`) : 0;
  const todayKey = Math.round((Date.parse(`${today}T00:00:00Z`) - first) / 86_400_000);
  return { from: Math.max(0, todayKey - lastDays + 1), toExclusive: Math.max(1, todayKey + 1) };
}

export function applyPick(filters: Filters, pick: Pick): Filters {
  return pick.kind === 'toggleKey' ? toggleKey(filters, pick.dim, pick.key) : setRange(filters, pick.dim, pick.range);
}

export function reduce(state: AppState, action: Action, now: Date): AppState {
  switch (action.kind) {
    case 'snapshotLoaded': {
      const previous = state.phase === 'ready' ? state : null;
      return {
        phase: 'ready',
        cube: action.cube,
        view: viewFromHash(action.cube, action.hash),
        tables: previous?.tables ?? new Set(),
        focus: null,
        rebuilding: false,
      };
    }
    case 'snapshotFailed':
      return { phase: 'failed', reason: action.reason };
    case 'hashChanged':
      return state.phase === 'ready' ? { ...state, view: viewFromHash(state.cube, action.hash) } : state;
    case 'pick':
      return withView(state, (view) => ({ ...view, filters: applyPick(view.filters, action.pick) }));
    case 'followEvidence':
      return withView(state, (view) => ({ ...view, filters: overlay(view.filters, action.finding.evidence) }), action.finding.focus);
    case 'removeFilter':
      return withView(state, (view) => ({ ...view, filters: withoutDim(view.filters, action.dim) }));
    case 'clearFilters':
      return withView(state, (view) => ({ ...view, filters: {} }));
    case 'setDayRange':
      if (state.phase !== 'ready') return state;
      return withView(state, (view) => ({
        ...view,
        filters: setRange(withoutDim(view.filters, 'week'), 'day', action.lastDays === null ? null : lastDaysRange(state.cube, action.lastDays, now)),
      }));
    case 'stackBy':
      return withView(state, (view) => ({ ...view, stackBy: action.stackBy }));
    case 'toggleTable': {
      if (state.phase !== 'ready') return state;
      const tables = new Set(state.tables);
      if (tables.has(action.chart)) tables.delete(action.chart);
      else tables.add(action.chart);
      return { ...state, tables, focus: null };
    }
    case 'rebuildStarted':
      return state.phase === 'ready' ? { ...state, rebuilding: true } : state;
  }
}

export function viewToHash(cube: Cube, view: ViewState): string {
  const filters = encodeFilters(cube, view.filters);
  const stack = view.stackBy === 'tool' ? '' : `stack=${view.stackBy}`;
  return [filters, stack].filter(Boolean).join('&');
}

export function viewFromHash(cube: Cube, hash: string): ViewState {
  const stack = /(?:^|[#&])stack=(tool|model|project)(?:&|$)/.exec(hash)?.[1] as StackDim | undefined;
  return { filters: decodeFilters(cube, hash), stackBy: stack ?? 'tool' };
}

export async function fetchCube(): Promise<{ ok: true; cube: Cube } | { ok: false; reason: string }> {
  const response = await fetch('/snapshot.json', { cache: 'no-store' });
  if (!response.ok) return { ok: false, reason: `GET /snapshot.json returned ${response.status}: ${await response.text()}` };
  const parsed = parseSnapshot(await response.json());
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  return { ok: true, cube: loadCube(parsed.snapshot, { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) };
}

export async function requestRebuild(): Promise<void> {
  const response = await fetch('/rebuild', { method: 'POST' });
  if (!response.ok) throw new Error(`POST /rebuild returned ${response.status}`);
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function button(label: string, onClick: () => void, className = 'button'): HTMLButtonElement {
  const element = node('button', className, label);
  element.type = 'button';
  element.addEventListener('click', onClick);
  return element;
}

function createTooltip(root: HTMLElement): Tooltip {
  const element = node('div', 'tooltip');
  element.setAttribute('role', 'status');
  element.hidden = true;
  root.append(element);
  return {
    show(at, title, rows: readonly TooltipRow[]) {
      element.replaceChildren();
      element.append(node('div', 'tooltip-title', title));
      for (const row of rows) {
        const line = node('div', 'tooltip-row');
        const key = node('span', `tooltip-key tooltip-key-${row.mark ?? 'line'}`);
        if (row.color) key.style.setProperty('--swatch', row.color);
        else key.classList.add('is-empty');
        line.append(node('span', 'tooltip-value', row.value), key, node('span', 'tooltip-label', row.label));
        element.append(line);
      }
      element.hidden = false;
      const margin = 14;
      const bounds = element.getBoundingClientRect();
      const left = at.clientX + margin + bounds.width > window.innerWidth ? at.clientX - margin - bounds.width : at.clientX + margin;
      const top = Math.min(window.innerHeight - bounds.height - 8, Math.max(8, at.clientY + margin));
      element.style.left = `${Math.max(8, left)}px`;
      element.style.top = `${top}px`;
    },
    hide() {
      element.hidden = true;
    },
  };
}

function filterLabel(cube: Cube, dim: Dim, filter: Filter): string {
  const labels = cube.labels(dim);
  if (filter.kind === 'range') {
    const from = labels[filter.from] ?? '';
    const to = labels[filter.toExclusive - 1] ?? '';
    return from === to ? `${dim} ${from}` : `${dim} ${from} → ${to}`;
  }
  const names = [...filter.keys].map((key) => {
    if (dim === 'session') {
      const info = cube.session(key);
      return info.title || info.id;
    }
    return labels[key] ?? String(key);
  });
  return names.length > 2 ? `${dim}: ${names.slice(0, 2).join(', ')} +${names.length - 2}` : `${dim}: ${names.join(', ')}`;
}

function renderToolbar(state: Extract<AppState, { phase: 'ready' }>, dispatch: (action: Action) => void): HTMLElement {
  const bar = node('div', 'toolbar');
  const presets = node('div', 'segmented');
  presets.setAttribute('aria-label', 'Date range');
  const dayFilter = state.view.filters.day;
  for (const [label, days] of [['All time', null], ['7 days', 7], ['30 days', 30], ['90 days', 90]] as const) {
    const expected = days === null ? null : lastDaysRange(state.cube, days, new Date());
    const active =
      days === null
        ? !dayFilter && !state.view.filters.week
        : dayFilter?.kind === 'range' && expected !== null && dayFilter.from === expected.from && dayFilter.toExclusive === expected.toExclusive;
    const control = button(label, () => dispatch({ kind: 'setDayRange', lastDays: days }), `segment${active ? ' is-active' : ''}`);
    control.setAttribute('aria-pressed', String(active));
    presets.append(control);
  }
  const stack = node('div', 'segmented');
  stack.append(node('span', 'segmented-label', 'Stack by'));
  for (const dim of STACK_DIMS) {
    const control = button(dim, () => dispatch({ kind: 'stackBy', stackBy: dim }), `segment${state.view.stackBy === dim ? ' is-active' : ''}`);
    control.setAttribute('aria-pressed', String(state.view.stackBy === dim));
    stack.append(control);
  }
  const chips = node('div', 'chips');
  for (const dim of DIMENSIONS) {
    const filter = state.view.filters[dim];
    if (!filter) continue;
    const chip = button(`${filterLabel(state.cube, dim, filter)}  ×`, () => dispatch({ kind: 'removeFilter', dim }), 'chip');
    chip.setAttribute('aria-label', `Remove filter ${filterLabel(state.cube, dim, filter)}`);
    chips.append(chip);
  }
  if (chips.childElementCount > 0) chips.append(button('Clear all', () => dispatch({ kind: 'clearFilters' }), 'link-button'));
  bar.append(presets, stack, chips);
  return bar;
}

function formatMetric(metric: { unit: Metric['unit']; value: number }): string {
  switch (metric.unit) {
    case 'ratio':
      return formatPercent(metric.value);
    case 'points':
      return `${metric.value >= 0 ? '+' : ''}${Math.round(metric.value * 100)} pts`;
    case 'usd':
      return formatUsd(metric.value);
    case 'tokens':
      return formatCount(metric.value);
    case 'count':
      return formatCount(metric.value);
  }
}

function renderFindings(findings: readonly Finding[], dispatch: (action: Action) => void): HTMLElement {
  const section = node('section', 'card findings');
  const header = node('div', 'card-header');
  header.append(node('h2', 'card-title', 'Recommendations'), node('p', 'card-subtitle', `${findings.length} for the current filters · thresholds live in web/rules.ts`));
  section.append(header);
  if (findings.length === 0) {
    section.append(node('p', 'muted', 'No rule fires for this selection.'));
    return section;
  }
  const list = node('ol', 'finding-list');
  for (const finding of findings) {
    const item = node('li', `finding severity-${finding.severity}`);
    const top = node('div', 'finding-top');
    top.append(node('span', `severity-badge severity-${finding.severity}`, finding.severity), node('strong', 'finding-title', finding.title), node('span', 'finding-subject', finding.subject));
    const metric = node('div', 'finding-metric');
    const observed = formatMetric(finding.metric);
    metric.append(
      node('span', 'muted', `${finding.metric.name}: `),
      node('strong', '', finding.basis === 'estimated' ? `≈${observed}` : observed),
      node('span', 'muted', ` ${finding.metric.comparator} ${formatMetric({ unit: finding.metric.unit, value: finding.metric.threshold })}`),
    );
    if (finding.impactUsd !== null) metric.append(node('span', 'impact', `impact ${finding.basis === 'estimated' ? '≈' : ''}${formatUsd(finding.impactUsd)}`));
    metric.append(node('span', `basis basis-${finding.basis}`, finding.basis));
    const actions = node('div', 'finding-actions');
    actions.append(button('Show evidence', () => dispatch({ kind: 'followEvidence', finding })));
    item.append(top, metric, node('p', 'finding-advice', finding.advice), actions);
    list.append(item);
  }
  section.append(list);
  return section;
}

function renderTable(view: TableView): HTMLElement {
  const table = node('table', 'data-table');
  const head = node('tr');
  for (const column of view.columns) head.append(node('th', '', column));
  table.append(node('thead'));
  table.tHead!.append(head);
  const body = node('tbody');
  for (const values of view.rows) {
    const row = node('tr');
    for (const value of values) row.append(node('td', '', value));
    body.append(row);
  }
  table.append(body);
  const scroller = node('div', 'table-scroll');
  scroller.append(table);
  return scroller;
}

const tooltips = new WeakMap<HTMLElement, Tooltip>();

export function render(root: HTMLElement, state: AppState, dispatch: (action: Action) => void): void {
  let tooltip = tooltips.get(root);
  if (!tooltip) {
    tooltip = createTooltip(document.body);
    tooltips.set(root, tooltip);
  }
  tooltip.hide();
  if (state.phase === 'loading') {
    root.replaceChildren(node('p', 'status-message', 'Loading snapshot…'));
    return;
  }
  if (state.phase === 'failed') {
    const message = node('div', 'status-message');
    message.append(node('p', '', 'Could not load usage data.'), node('pre', '', state.reason));
    root.replaceChildren(message);
    return;
  }
  const { cube, view } = state;
  const selection = cube.select(view.filters);
  const findings = evaluateRules({ cube, selection, now: new Date() });
  const header = node('header', 'page-header');
  const titleRow = node('div', 'title-row');
  titleRow.append(node('h1', '', 'Tokenomics'), node('span', 'muted', state.rebuilding ? 'Rebuilding…' : `${formatCount(cube.rowCount)} requests from Claude Code, Codex and Cursor`));
  header.append(titleRow, renderToolbar(state, dispatch));
  const grid = node('div', `grid${state.rebuilding ? ' is-refreshing' : ''}`);
  const onPick = (pick: Pick) => dispatch({ kind: 'pick', pick });
  const onRebuild = () => dispatch({ kind: 'rebuildStarted' });
  const cards = new Map<ChartId, HTMLElement>();
  for (const spec of CHARTS) {
    const card = node('section', `card span-${spec.span}`);
    card.id = `chart-${spec.id}`;
    const cardHeader = node('div', 'card-header');
    const titles = node('div');
    titles.append(node('h2', 'card-title', spec.title), node('p', 'card-subtitle', spec.subtitle));
    const showTable = state.tables.has(spec.id);
    const toggle = button(showTable ? 'Chart' : 'Table', () => dispatch({ kind: 'toggleTable', chart: spec.id }), 'link-button');
    toggle.setAttribute('aria-pressed', String(showTable));
    cardHeader.append(titles);
    if (spec.id !== 'kpis' && spec.id !== 'topSessions' && spec.id !== 'sources') cardHeader.append(toggle);
    const body = node('div', 'card-body');
    card.append(cardHeader, body);
    grid.append(card);
    cards.set(spec.id, card);
    if (spec.id === 'kpis') grid.append(renderFindings(findings, dispatch));
  }
  root.replaceChildren(header, grid);
  for (const spec of CHARTS) {
    const card = cards.get(spec.id)!;
    const body = card.querySelector<HTMLElement>('.card-body')!;
    const context = { cube, selection: selection.without(spec.ownDims(view.stackBy)), filters: view.filters, stackBy: view.stackBy, tooltip, onPick, onRebuild };
    const table = spec.render(body, context);
    if (table && state.tables.has(spec.id)) body.replaceChildren(renderTable(table));
  }
  if (state.focus) cards.get(state.focus)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export async function boot(root: HTMLElement): Promise<void> {
  let state: AppState = { phase: 'loading' };
  const dispatch = (action: Action) => {
    const next = reduce(state, action, new Date());
    if (next === state) return;
    state = next;
    if (state.phase === 'ready' && action.kind !== 'snapshotLoaded' && action.kind !== 'hashChanged') {
      const hash = viewToHash(state.cube, state.view);
      if (decodeURIComponent(location.hash.slice(1)) !== decodeURIComponent(hash)) history.replaceState(null, '', hash ? `#${hash}` : location.pathname);
    }
    render(root, state, dispatch);
    if (action.kind === 'rebuildStarted') void rebuild();
  };
  const load = async () => {
    try {
      const result = await fetchCube();
      dispatch(result.ok ? { kind: 'snapshotLoaded', cube: result.cube, hash: location.hash } : { kind: 'snapshotFailed', reason: result.reason });
    } catch (error) {
      dispatch({ kind: 'snapshotFailed', reason: String(error) });
    }
  };
  const rebuild = async () => {
    try {
      await requestRebuild();
    } catch (error) {
      console.error(error);
    }
    await load();
  };
  window.addEventListener('hashchange', () => dispatch({ kind: 'hashChanged', hash: location.hash }));
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => render(root, state, dispatch), 150);
  });
  render(root, state, dispatch);
  await load();
}

