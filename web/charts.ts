import { TOKEN_KINDS } from '../shared/snapshot.ts';
import type { Fidelity, SourceReport, TokenKind } from '../shared/snapshot.ts';
import type { Cube, Dim, Filters, OrdinalDim, Selection } from './cube.ts';
import type { ChartFocus } from './rules.ts';

export type StackDim = Extract<Dim, 'tool' | 'model' | 'project'>;
export const STACK_DIMS: readonly StackDim[] = ['tool', 'model', 'project'];

export type ChartId = ChartFocus | 'kpis';

export type Pick =
  | { kind: 'toggleKey'; dim: Dim; key: number }
  | { kind: 'brush'; dim: OrdinalDim; range: { from: number; toExclusive: number } | null };

export type TooltipRow = { label: string; value: string; color?: string; mark?: 'line' | 'hatch' };

export type Tooltip = {
  show(at: { clientX: number; clientY: number }, title: string, rows: readonly TooltipRow[]): void;
  hide(): void;
};

export type TableView = { columns: readonly string[]; rows: readonly (readonly string[])[] };

export type ChartContext = {
  cube: Cube;
  selection: Selection;
  filters: Filters;
  stackBy: StackDim;
  tooltip: Tooltip;
  onPick: (pick: Pick) => void;
  onRebuild: () => void;
};

export type ChartSpec = {
  id: ChartId;
  title: string;
  subtitle: string;
  span: 'full' | 'half';
  ownDims: (stackBy: StackDim) => readonly Dim[];
  render: (host: HTMLElement, context: ChartContext) => TableView | null;
};

const SVG = 'http://www.w3.org/2000/svg';
const SERIES_SLOTS = 8;
const OTHER_COLOR = 'var(--series-other)';
const HATCH_ID = 'hatch-estimated';

export const KIND_LABELS: Readonly<Record<TokenKind, string>> = {
  input: 'Input',
  cacheWrite5m: 'Cache write 5m',
  cacheWrite1h: 'Cache write 1h',
  cacheRead: 'Cache read',
  output: 'Output',
  reasoning: 'Reasoning',
  unsplit: 'Unsplit total',
};

export function seriesColor(slot: number): string {
  return slot < SERIES_SLOTS ? `var(--series-${slot + 1})` : OTHER_COLOR;
}

export function formatUsd(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (magnitude >= 10_000) return `$${(value / 1_000).toFixed(1)}K`;
  if (magnitude >= 100) return `$${Math.round(value).toLocaleString('en-US')}`;
  if (magnitude >= 1) return `$${value.toFixed(2)}`;
  if (magnitude === 0) return '$0';
  return `$${value.toFixed(3)}`;
}

export function formatCount(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (magnitude >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (magnitude >= 1e4) return `${(value / 1e3).toFixed(1)}K`;
  return Math.round(value).toLocaleString('en-US');
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
}

export function approx(text: string, estimated: number, total: number): string {
  return estimated > 0 && estimated >= Math.abs(total) * 0.0005 ? `≈${text}` : text;
}

function svgNode<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number> = {}, style?: string): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  if (style) node.setAttribute('style', style);
  return node;
}

function htmlNode<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgText(x: number, y: number, text: string, attributes: Record<string, string | number> = {}): SVGTextElement {
  const node = svgNode('text', { x, y, ...attributes });
  node.textContent = text;
  return node;
}

function createSvg(width: number, height: number, label: string): SVGSVGElement {
  const svg = svgNode('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': label, class: 'chart-svg' });
  const defs = svgNode('defs');
  const pattern = svgNode('pattern', { id: HATCH_ID, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  pattern.append(svgNode('rect', { x: 0, y: 0, width: 2.5, height: 6 }, 'fill: var(--surface-1); opacity: 0.85'));
  defs.append(pattern);
  svg.append(defs);
  return svg;
}

function roundedBarPath(x: number, y: number, width: number, height: number, end: 'top' | 'right' | 'none'): string {
  const r = Math.min(4, end === 'top' ? width / 2 : height / 2, end === 'top' ? height : width);
  if (end === 'none' || r < 1) return `M${x},${y}h${width}v${height}h${-width}Z`;
  if (end === 'top') return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
  return `M${x},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height - r}Q${x + width},${y + height} ${x + width - r},${y + height}H${x}Z`;
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exponent = Math.pow(10, Math.floor(Math.log10(value)));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * exponent >= value) return step * exponent;
  return 10 * exponent;
}

function hostWidth(host: HTMLElement): number {
  return Math.max(280, Math.floor(host.clientWidth || host.parentElement?.clientWidth || 640));
}

type Series = { key: number; label: string; color: string };

const globalRankCache = new WeakMap<Cube, Map<Dim, Map<number, number>>>();

function globalSlot(cube: Cube, dim: StackDim, key: number): number {
  if (dim === 'tool') return key;
  let byDim = globalRankCache.get(cube);
  if (!byDim) {
    byDim = new Map();
    globalRankCache.set(cube, byDim);
  }
  let ranks = byDim.get(dim);
  if (!ranks) {
    const rollup = cube.select({}).rollup(dim);
    ranks = new Map(rollup.keys.map((k, index) => [k, index]));
    byDim.set(dim, ranks);
  }
  const rank = ranks.get(key) ?? SERIES_SLOTS;
  return rank < SERIES_SLOTS - 1 ? rank : SERIES_SLOTS;
}

export function colorForKey(cube: Cube, dim: StackDim, key: number): string {
  return seriesColor(globalSlot(cube, dim, key));
}

function legend(items: readonly { label: string; color: string; shape: 'rect' | 'line' | 'dot' | 'hatch' | 'ring'; onClick?: () => void; active?: boolean }[]): HTMLElement {
  const list = htmlNode('div', 'legend');
  for (const item of items) {
    const entry = htmlNode(item.onClick ? 'button' : 'span', `legend-item${item.active === false ? ' is-muted' : ''}`);
    const swatch = htmlNode('span', `swatch swatch-${item.shape}`);
    swatch.style.setProperty('--swatch', item.color);
    entry.append(swatch, document.createTextNode(item.label));
    if (item.onClick) entry.addEventListener('click', item.onClick);
    list.append(entry);
  }
  return list;
}

function hatchLegendItem() {
  return { label: 'Estimated', color: 'var(--text-muted)', shape: 'hatch' as const };
}

function activeKeys(filters: Filters, dim: Dim): ReadonlySet<number> | null {
  const filter = filters[dim];
  return filter?.kind === 'keys' ? filter.keys : null;
}

function activeRange(filters: Filters, dim: Dim): { from: number; toExclusive: number } | null {
  const filter = filters[dim];
  return filter?.kind === 'range' ? filter : null;
}

function trimmedOrdinalKeys(keys: readonly number[], hasData: (key: number) => boolean): number[] {
  let first = keys.findIndex(hasData);
  if (first < 0) return [];
  let last = keys.length - 1;
  while (last > first && !hasData(keys[last])) last--;
  first = Math.max(0, first);
  return keys.slice(first, last + 1);
}

type Segment = { series: Series; measured: number; estimated: number };

type ColumnChartOptions = {
  host: HTMLElement;
  context: ChartContext;
  xDim: OrdinalDim;
  xKeys: readonly number[];
  series: readonly Series[];
  segments: (x: number) => Segment[];
  format: (value: number) => string;
  normalize: boolean;
  label: string;
  onSegmentClick: (x: number, segment: Segment) => void;
  brush: boolean;
};

function columnChart(options: ColumnChartOptions): void {
  const { host, context, xKeys, xDim } = options;
  const width = hostWidth(host);
  const height = 260;
  const margin = { top: 12, right: 12, bottom: 28, left: 56 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const labels = context.cube.labels(xDim);
  const stacks = xKeys.map((x) => {
    const segments = options.segments(x).filter((segment) => segment.measured + segment.estimated > 0);
    const total = segments.reduce((sum, segment) => sum + segment.measured + segment.estimated, 0);
    return { x, segments, total };
  });
  const maxTotal = options.normalize ? 1 : niceMax(Math.max(0, ...stacks.map((stack) => stack.total)));
  const band = plotWidth / Math.max(1, xKeys.length);
  const barWidth = Math.max(1, Math.min(24, band - Math.min(2, band * 0.25)));
  const scaleY = (value: number) => (value / maxTotal) * plotHeight;
  const svg = createSvg(width, height, options.label);
  const grid = svgNode('g', { class: 'grid' });
  for (let tick = 0; tick <= 4; tick++) {
    const value = (maxTotal * tick) / 4;
    const y = margin.top + plotHeight - scaleY(value);
    grid.append(svgNode('line', { x1: margin.left, x2: width - margin.right, y1: y, y2: y, class: tick === 0 ? 'axis-line' : 'grid-line' }));
    grid.append(svgText(margin.left - 8, y + 4, options.normalize ? formatPercent(value) : options.format(value), { class: 'tick', 'text-anchor': 'end' }));
  }
  svg.append(grid);
  const labelEvery = Math.max(1, Math.ceil(xKeys.length / Math.max(1, Math.floor(plotWidth / 72))));
  xKeys.forEach((x, index) => {
    if (index % labelEvery !== 0) return;
    svg.append(svgText(margin.left + band * index + band / 2, height - 8, labels[x].slice(5), { class: 'tick', 'text-anchor': 'middle' }));
  });
  const selectedRange = activeRange(context.filters, xDim);
  const selectedKeys = activeKeys(context.filters, xDim);
  const bars = svgNode('g');
  const layout: { x: number; left: number; parts: { top: number; bottom: number; segment: Segment }[] }[] = [];
  stacks.forEach((stack, index) => {
    const left = margin.left + band * index + (band - barWidth) / 2;
    let base = margin.top + plotHeight;
    const parts: { top: number; bottom: number; segment: Segment }[] = [];
    const inRange = (!selectedRange || (stack.x >= selectedRange.from && stack.x < selectedRange.toExclusive)) && (!selectedKeys || selectedKeys.has(stack.x));
    stack.segments.forEach((segment, segmentIndex) => {
      const amount = segment.measured + segment.estimated;
      const heightPx = scaleY(options.normalize ? amount / stack.total : amount);
      const top = base - heightPx;
      const gap = segmentIndex > 0 && heightPx > 3 ? 2 : 0;
      const isTop = segmentIndex === stack.segments.length - 1;
      const drawHeight = Math.max(0, heightPx - gap);
      const group = svgNode('g', { opacity: inRange ? 1 : 0.35 });
      group.append(svgNode('path', { d: roundedBarPath(left, top, barWidth, drawHeight, isTop && barWidth >= 8 ? 'top' : 'none') }, `fill: ${segment.series.color}`));
      if (segment.estimated > 0) {
        const estimatedHeight = drawHeight * (segment.estimated / amount);
        group.append(svgNode('rect', { x: left, y: top, width: barWidth, height: estimatedHeight, fill: `url(#${HATCH_ID})` }));
      }
      bars.append(group);
      parts.push({ top, bottom: base, segment });
      base = top;
    });
    layout.push({ x: stack.x, left, parts });
  });
  svg.append(bars);
  const brushRect = svgNode('rect', { y: margin.top, height: plotHeight, class: 'brush', visibility: 'hidden' });
  svg.append(brushRect);
  const hover = svgNode('rect', { y: margin.top, height: plotHeight, width: band, class: 'hover-band', visibility: 'hidden' });
  svg.insertBefore(hover, bars);
  const hit = svgNode('rect', { x: margin.left, y: margin.top, width: plotWidth, height: plotHeight, class: 'hit-layer', tabindex: 0 });
  svg.append(hit);
  const indexAt = (clientX: number) => {
    const bounds = svg.getBoundingClientRect();
    const scale = bounds.width > 0 ? width / bounds.width : 1;
    return Math.max(0, Math.min(xKeys.length - 1, Math.floor(((clientX - bounds.left) * scale - margin.left) / band)));
  };
  const segmentAt = (index: number, clientY: number) => {
    const bounds = svg.getBoundingClientRect();
    const scale = bounds.height > 0 ? height / bounds.height : 1;
    const y = (clientY - bounds.top) * scale;
    return layout[index]?.parts.find((part) => y >= part.top && y <= part.bottom)?.segment ?? null;
  };
  const showTip = (event: { clientX: number; clientY: number }, index: number) => {
    const stack = stacks[index];
    hover.setAttribute('x', String(margin.left + band * index));
    hover.setAttribute('visibility', 'visible');
    const rows: TooltipRow[] = [...stack.segments].reverse().map((segment) => ({
      label: segment.series.label,
      value: approx(options.normalize ? formatPercent((segment.measured + segment.estimated) / stack.total) : options.format(segment.measured + segment.estimated), segment.estimated, segment.measured + segment.estimated),
      color: segment.series.color,
      mark: segment.estimated > 0 ? 'hatch' : undefined,
    }));
    const estimated = stack.segments.reduce((sum, segment) => sum + segment.estimated, 0);
    const title = `${labels[stack.x]} · ${approx(options.format(stack.total), estimated, stack.total)}`;
    context.tooltip.show(event, title, rows.length ? rows : [{ label: 'No usage', value: '' }]);
  };
  let dragStart: number | null = null;
  hit.addEventListener('pointerdown', (event) => {
    dragStart = event.clientX;
    if (options.brush) hit.setPointerCapture(event.pointerId);
  });
  hit.addEventListener('pointermove', (event) => {
    const index = indexAt(event.clientX);
    showTip(event, index);
    if (dragStart === null || !options.brush) return;
    const startIndex = indexAt(dragStart);
    const lo = Math.min(startIndex, index);
    const hi = Math.max(startIndex, index);
    brushRect.setAttribute('x', String(margin.left + band * lo));
    brushRect.setAttribute('width', String(band * (hi - lo + 1)));
    brushRect.setAttribute('visibility', Math.abs(event.clientX - dragStart) > 4 ? 'visible' : 'hidden');
  });
  hit.addEventListener('pointerleave', () => {
    hover.setAttribute('visibility', 'hidden');
    context.tooltip.hide();
  });
  hit.addEventListener('pointerup', (event) => {
    const start = dragStart;
    dragStart = null;
    if (start === null) return;
    const index = indexAt(event.clientX);
    if (options.brush && Math.abs(event.clientX - start) > 4) {
      const startIndex = indexAt(start);
      const lo = xKeys[Math.min(startIndex, index)];
      const hi = xKeys[Math.max(startIndex, index)];
      context.onPick({ kind: 'brush', dim: xDim, range: { from: lo, toExclusive: hi + 1 } });
      return;
    }
    const segment = segmentAt(index, event.clientY);
    if (segment) options.onSegmentClick(stacks[index].x, segment);
    else if (options.brush) context.onPick({ kind: 'brush', dim: xDim, range: { from: stacks[index].x, toExclusive: stacks[index].x + 1 } });
  });
  let focusIndex = xKeys.length - 1;
  hit.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') focusIndex = Math.max(0, focusIndex - 1);
    else if (event.key === 'ArrowRight') focusIndex = Math.min(xKeys.length - 1, focusIndex + 1);
    else if (event.key === 'Enter' && options.brush) {
      context.onPick({ kind: 'brush', dim: xDim, range: { from: xKeys[focusIndex], toExclusive: xKeys[focusIndex] + 1 } });
      return;
    } else return;
    event.preventDefault();
    const bounds = svg.getBoundingClientRect();
    showTip({ clientX: bounds.left + ((margin.left + band * focusIndex + band / 2) * bounds.width) / width, clientY: bounds.top + margin.top }, focusIndex);
  });
  hit.addEventListener('blur', () => {
    hover.setAttribute('visibility', 'hidden');
    context.tooltip.hide();
  });
  const items = options.series.map((series) => ({ label: series.label, color: series.color, shape: 'rect' as const }));
  const anyEstimated = stacks.some((stack) => stack.segments.some((segment) => segment.estimated > 0));
  host.append(legend(anyEstimated ? [...items, hatchLegendItem()] : items), svg);
}

function stackSeries(context: ChartContext, keys: readonly number[]): { series: Series[]; slotOf: (key: number) => Series } {
  const { cube, stackBy } = context;
  const labels = cube.labels(stackBy);
  const seen = new Map<number, Series>();
  const other: Series = { key: -1, label: 'Other', color: OTHER_COLOR };
  let hasOther = false;
  const slotOf = (key: number) => {
    const slot = globalSlot(cube, stackBy, key);
    if (slot >= SERIES_SLOTS) {
      hasOther = true;
      return other;
    }
    let series = seen.get(key);
    if (!series) {
      series = { key, label: labels[key], color: seriesColor(slot) };
      seen.set(key, series);
    }
    return series;
  };
  keys.forEach(slotOf);
  const series = [...seen.values()].sort((a, b) => globalSlot(cube, stackBy, a.key) - globalSlot(cube, stackBy, b.key));
  return { series: hasOther ? [...series, other] : series, slotOf };
}

function renderDailyCost(host: HTMLElement, context: ChartContext): TableView {
  const { cube, selection, stackBy } = context;
  const stack = selection.rollup2('day', stackBy);
  const dayTotals = selection.rollup('day');
  const xKeys = trimmedOrdinalKeys(stack.outer, (key) => dayTotals.value(key, 'requests') > 0);
  const { series, slotOf } = stackSeries(context, stack.inner);
  const segmentsFor = (day: number): Segment[] => {
    const merged = new Map<Series, Segment>();
    for (const key of stack.inner) {
      const target = slotOf(key);
      const entry = merged.get(target) ?? { series: target, measured: 0, estimated: 0 };
      entry.measured += stack.value(day, key, 'costUsd', 'measured');
      entry.estimated += stack.value(day, key, 'costUsd', 'estimated');
      merged.set(target, entry);
    }
    return series.map((s) => merged.get(s)).filter((segment): segment is Segment => !!segment);
  };
  columnChart({
    host,
    context,
    xDim: 'day',
    xKeys,
    series,
    segments: segmentsFor,
    format: formatUsd,
    normalize: false,
    label: `Cost per day stacked by ${stackBy}`,
    brush: true,
    onSegmentClick: (_day, segment) => {
      if (segment.series.key >= 0) context.onPick({ kind: 'toggleKey', dim: stackBy, key: segment.series.key });
    },
  });
  return {
    columns: ['Day', ...series.map((s) => s.label), 'Estimated'],
    rows: xKeys.map((day) => {
      const segments = segmentsFor(day);
      const cell = (s: Series) => {
        const segment = segments.find((entry) => entry.series === s);
        return segment ? formatUsd(segment.measured + segment.estimated) : '';
      };
      return [cube.labels('day')[day], ...series.map(cell), formatUsd(segments.reduce((sum, segment) => sum + segment.estimated, 0))];
    }),
  };
}

function renderTokenMix(host: HTMLElement, context: ChartContext): TableView {
  const { cube, selection } = context;
  const byWeek = selection.rollup('week');
  const xKeys = trimmedOrdinalKeys(byWeek.keys, (key) => byWeek.value(key, 'requests') > 0);
  const kindSeries: Series[] = TOKEN_KINDS.map((kind, index) => ({ key: index, label: KIND_LABELS[kind], color: seriesColor(index) }));
  const present = kindSeries.filter((series) => xKeys.some((week) => byWeek.value(week, TOKEN_KINDS[series.key]) > 0));
  const segmentsFor = (week: number): Segment[] =>
    present.map((series) => ({
      series,
      measured: byWeek.value(week, TOKEN_KINDS[series.key], 'measured'),
      estimated: byWeek.value(week, TOKEN_KINDS[series.key], 'estimated'),
    }));
  columnChart({
    host,
    context,
    xDim: 'week',
    xKeys,
    series: present,
    segments: segmentsFor,
    format: formatCount,
    normalize: true,
    label: 'Weekly token mix by kind',
    brush: false,
    onSegmentClick: (week) => context.onPick({ kind: 'toggleKey', dim: 'week', key: week }),
  });
  return {
    columns: ['Week of', ...present.map((series) => series.label)],
    rows: xKeys.map((week) => [cube.labels('week')[week], ...present.map((series) => formatCount(byWeek.value(week, TOKEN_KINDS[series.key])))]),
  };
}

function renderRankedBars(host: HTMLElement, context: ChartContext, dim: 'project' | 'model', top: number): TableView {
  const { cube, selection } = context;
  const rollup = selection.rollup(dim);
  const labels = cube.labels(dim);
  const keys = rollup.keys.filter((key) => rollup.value(key, 'costUsd') > 0 || rollup.value(key, 'unpricedTokens') > 0).slice(0, top);
  const selected = activeKeys(context.filters, dim);
  const width = hostWidth(host);
  const labelWidth = Math.min(200, Math.floor(width * 0.38));
  const valueWidth = 64;
  const rowHeight = 28;
  const barThickness = 16;
  const plotWidth = width - labelWidth - valueWidth - 16;
  const max = niceMax(Math.max(0, ...keys.map((key) => rollup.value(key, 'costUsd'))));
  const height = Math.max(rowHeight, keys.length * rowHeight) + 8;
  const svg = createSvg(width, height, `Cost by ${dim}`);
  keys.forEach((key, index) => {
    const y = 4 + index * rowHeight;
    const measured = rollup.value(key, 'costUsd', 'measured');
    const estimated = rollup.value(key, 'costUsd', 'estimated');
    const unpriced = rollup.value(key, 'unpricedTokens');
    const total = measured + estimated;
    const isActive = !selected || selected.has(key);
    const row = svgNode('g', { class: 'bar-row', tabindex: 0, role: 'button', 'aria-pressed': selected?.has(key) ? 'true' : 'false', opacity: isActive ? 1 : 0.35 });
    row.append(svgNode('rect', { x: 0, y, width, height: rowHeight, class: 'row-hit' }));
    const name = labels[key];
    row.append(svgText(labelWidth - 8, y + rowHeight / 2 + 4, name.length > 28 ? `${name.slice(0, 27)}…` : name, { class: 'row-label', 'text-anchor': 'end' }));
    const color = dim === 'model' || dim === 'project' ? colorForKey(cube, dim, key) : seriesColor(0);
    const barY = y + (rowHeight - barThickness) / 2;
    const measuredWidth = (measured / max) * plotWidth;
    const estimatedWidth = (estimated / max) * plotWidth;
    if (measuredWidth > 0) row.append(svgNode('path', { d: roundedBarPath(labelWidth, barY, measuredWidth, barThickness, estimatedWidth > 0 ? 'none' : 'right') }, `fill: ${color}`));
    if (estimatedWidth > 0) {
      const start = labelWidth + measuredWidth + (measuredWidth > 0 ? 2 : 0);
      row.append(svgNode('path', { d: roundedBarPath(start, barY, estimatedWidth, barThickness, 'right') }, `fill: ${color}`));
      row.append(svgNode('path', { d: roundedBarPath(start, barY, estimatedWidth, barThickness, 'right'), fill: `url(#${HATCH_ID})` }));
    }
    const valueText = total > 0 ? approx(formatUsd(total), estimated, total) : `${formatCount(unpriced)} tok unpriced`;
    row.append(svgText(labelWidth + measuredWidth + estimatedWidth + 8, y + rowHeight / 2 + 4, valueText, { class: 'row-value' }));
    const tip = (event: { clientX: number; clientY: number }) =>
      context.tooltip.show(event, name, [
        { label: 'Measured cost', value: formatUsd(measured), color },
        { label: 'Estimated cost', value: formatUsd(estimated), color, mark: 'hatch' },
        { label: 'Requests', value: formatCount(rollup.value(key, 'requests')) },
        ...(unpriced > 0 ? [{ label: 'Unpriced tokens', value: formatCount(unpriced) }] : []),
      ]);
    row.addEventListener('pointermove', tip);
    row.addEventListener('pointerleave', () => context.tooltip.hide());
    row.addEventListener('focus', () => {
      const bounds = row.getBoundingClientRect();
      tip({ clientX: bounds.left + labelWidth, clientY: bounds.top });
    });
    row.addEventListener('blur', () => context.tooltip.hide());
    const toggle = () => context.onPick({ kind: 'toggleKey', dim, key });
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    });
    svg.append(row);
  });
  const anyEstimated = keys.some((key) => rollup.value(key, 'costUsd', 'estimated') > 0);
  if (anyEstimated) host.append(legend([{ label: 'Measured', color: 'var(--text-muted)', shape: 'rect' }, hatchLegendItem()]));
  host.append(svg);
  return {
    columns: [dim === 'model' ? 'Model' : 'Project', 'Cost', 'Estimated part', 'Requests', 'Unpriced tokens'],
    rows: keys.map((key) => [labels[key], formatUsd(rollup.value(key, 'costUsd')), formatUsd(rollup.value(key, 'costUsd', 'estimated')), formatCount(rollup.value(key, 'requests')), formatCount(rollup.value(key, 'unpricedTokens'))]),
  };
}

const INPUT_SIDE_KINDS: readonly TokenKind[] = ['input', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h'];

function renderCacheHitByWeek(host: HTMLElement, context: ChartContext): TableView {
  const { cube, selection } = context;
  const byWeekTool = selection.rollup2('week', 'tool');
  const byWeek = selection.rollup('week');
  const weeks = trimmedOrdinalKeys(byWeekTool.outer, (key) => byWeek.value(key, 'requests') > 0);
  const toolLabels = cube.labels('tool');
  const rate = (week: number, tool: number): number | null => {
    const side = INPUT_SIDE_KINDS.reduce((sum, kind) => sum + byWeekTool.value(week, tool, kind, 'measured'), 0);
    return side > 0 ? byWeekTool.value(week, tool, 'cacheRead', 'measured') / side : null;
  };
  const tools = byWeekTool.inner.filter((tool) => weeks.some((week) => rate(week, tool) !== null)).sort((a, b) => a - b);
  const selectedTools = activeKeys(context.filters, 'tool');
  const width = hostWidth(host);
  const height = 240;
  const margin = { top: 12, right: 16, bottom: 28, left: 48 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const step = weeks.length > 1 ? plotWidth / (weeks.length - 1) : 0;
  const xOf = (index: number) => margin.left + (weeks.length > 1 ? step * index : plotWidth / 2);
  const yOf = (value: number) => margin.top + plotHeight - value * plotHeight;
  const svg = createSvg(width, height, 'Weekly cache hit rate per tool');
  for (let tick = 0; tick <= 4; tick++) {
    const y = yOf(tick / 4);
    svg.append(svgNode('line', { x1: margin.left, x2: width - margin.right, y1: y, y2: y, class: tick === 0 ? 'axis-line' : 'grid-line' }));
    svg.append(svgText(margin.left - 8, y + 4, formatPercent(tick / 4), { class: 'tick', 'text-anchor': 'end' }));
  }
  const labelEvery = Math.max(1, Math.ceil(weeks.length / Math.max(1, Math.floor(plotWidth / 72))));
  weeks.forEach((week, index) => {
    if (index % labelEvery === 0) svg.append(svgText(xOf(index), height - 8, cube.labels('week')[week].slice(5), { class: 'tick', 'text-anchor': 'middle' }));
  });
  const selectedWeeks = activeKeys(context.filters, 'week');
  if (selectedWeeks) {
    weeks.forEach((week, index) => {
      if (selectedWeeks.has(week)) svg.append(svgNode('rect', { x: xOf(index) - Math.max(step, 12) / 2, y: margin.top, width: Math.max(step, 12), height: plotHeight, class: 'selected-band' }));
    });
  }
  for (const tool of tools) {
    const color = seriesColor(tool);
    let path = '';
    let lastPoint: { x: number; y: number } | null = null;
    weeks.forEach((week, index) => {
      const value = rate(week, tool);
      if (value === null) return;
      const point = { x: xOf(index), y: yOf(value) };
      path += `${lastPoint ? 'L' : 'M'}${point.x},${point.y}`;
      lastPoint = point;
    });
    const muted = selectedTools && !selectedTools.has(tool);
    svg.append(svgNode('path', { d: path, class: 'series-line', opacity: muted ? 0.3 : 1 }, `stroke: ${color}`));
    if (lastPoint) {
      const end = lastPoint as { x: number; y: number };
      svg.append(svgNode('circle', { cx: end.x, cy: end.y, r: 4, class: 'end-dot' }, `fill: ${color}`));
    }
  }
  const crosshair = svgNode('line', { y1: margin.top, y2: margin.top + plotHeight, class: 'crosshair', visibility: 'hidden' });
  svg.append(crosshair);
  const hit = svgNode('rect', { x: margin.left - step / 2, y: margin.top, width: plotWidth + step, height: plotHeight, class: 'hit-layer', tabindex: 0 });
  svg.append(hit);
  const indexAt = (clientX: number) => {
    const bounds = svg.getBoundingClientRect();
    const scale = bounds.width > 0 ? width / bounds.width : 1;
    const x = (clientX - bounds.left) * scale;
    return weeks.length > 1 ? Math.max(0, Math.min(weeks.length - 1, Math.round((x - margin.left) / step))) : 0;
  };
  const show = (event: { clientX: number; clientY: number }, index: number) => {
    crosshair.setAttribute('x1', String(xOf(index)));
    crosshair.setAttribute('x2', String(xOf(index)));
    crosshair.setAttribute('visibility', 'visible');
    const week = weeks[index];
    context.tooltip.show(
      event,
      `Week of ${cube.labels('week')[week]}`,
      tools.map((tool) => {
        const value = rate(week, tool);
        return { label: toolLabels[tool], value: value === null ? 'no measured input' : formatPercent(value), color: seriesColor(tool), mark: 'line' as const };
      }),
    );
  };
  hit.addEventListener('pointermove', (event) => {
    if (weeks.length) show(event, indexAt(event.clientX));
  });
  hit.addEventListener('pointerleave', () => {
    crosshair.setAttribute('visibility', 'hidden');
    context.tooltip.hide();
  });
  hit.addEventListener('click', (event) => {
    if (weeks.length) context.onPick({ kind: 'toggleKey', dim: 'week', key: weeks[indexAt(event.clientX)] });
  });
  let focusIndex = weeks.length - 1;
  hit.addEventListener('keydown', (event) => {
    if (!weeks.length) return;
    if (event.key === 'ArrowLeft') focusIndex = Math.max(0, focusIndex - 1);
    else if (event.key === 'ArrowRight') focusIndex = Math.min(weeks.length - 1, focusIndex + 1);
    else if (event.key === 'Enter') {
      context.onPick({ kind: 'toggleKey', dim: 'week', key: weeks[focusIndex] });
      return;
    } else return;
    event.preventDefault();
    const bounds = svg.getBoundingClientRect();
    show({ clientX: bounds.left + (xOf(focusIndex) * bounds.width) / width, clientY: bounds.top + margin.top }, focusIndex);
  });
  host.append(
    legend(
      tools.map((tool) => ({
        label: toolLabels[tool],
        color: seriesColor(tool),
        shape: 'line' as const,
        active: !selectedTools || selectedTools.has(tool),
        onClick: () => context.onPick({ kind: 'toggleKey', dim: 'tool', key: tool }),
      })),
    ),
    svg,
  );
  return {
    columns: ['Week of', ...tools.map((tool) => toolLabels[tool])],
    rows: weeks.map((week) => [cube.labels('week')[week], ...tools.map((tool) => {
      const value = rate(week, tool);
      return value === null ? '' : formatPercent(value);
    })]),
  };
}

const TIER_SLOTS: Readonly<Record<string, number>> = { premium: 0, standard: 1, small: 2 };

function tierColor(tier: string): string {
  return tier in TIER_SLOTS ? seriesColor(TIER_SLOTS[tier]) : OTHER_COLOR;
}

type SessionPoint = { key: number; requests: number; cost: number; estimated: number; tier: string; title: string };

function sessionPoints(context: ChartContext): SessionPoint[] {
  const { cube, selection } = context;
  const byTier = selection.rollup2('session', 'tier');
  const tierLabels = cube.labels('tier');
  return byTier.outer
    .map((key) => {
      let cost = 0;
      let estimated = 0;
      let requests = 0;
      let bestTier = byTier.inner[0];
      let bestCost = -1;
      for (const tier of byTier.inner) {
        const tierCost = byTier.value(key, tier, 'costUsd');
        cost += tierCost;
        estimated += byTier.value(key, tier, 'costUsd', 'estimated');
        requests += byTier.value(key, tier, 'requests');
        if (tierCost > bestCost) {
          bestCost = tierCost;
          bestTier = tier;
        }
      }
      const info = cube.session(key);
      return { key, requests, cost, estimated, tier: tierLabels[bestTier], title: info.title || info.id };
    })
    .filter((point) => point.requests > 0);
}

function renderSessionScatter(host: HTMLElement, context: ChartContext): TableView {
  const points = sessionPoints(context).filter((point) => point.cost > 0);
  const selected = activeKeys(context.filters, 'session');
  const width = hostWidth(host);
  const height = 280;
  const margin = { top: 12, right: 16, bottom: 36, left: 56 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxRequests = Math.max(10, ...points.map((point) => point.requests));
  const minCost = Math.max(0.001, Math.min(1, ...points.map((point) => point.cost)));
  const maxCost = Math.max(minCost * 10, ...points.map((point) => point.cost));
  const logX = (value: number) => margin.left + (Math.log10(Math.max(1, value)) / Math.log10(maxRequests)) * plotWidth;
  const costFloor = Math.pow(10, Math.floor(Math.log10(minCost)));
  const costCeil = Math.pow(10, Math.ceil(Math.log10(maxCost)));
  const logY = (value: number) => margin.top + plotHeight - ((Math.log10(Math.max(costFloor, value)) - Math.log10(costFloor)) / (Math.log10(costCeil) - Math.log10(costFloor))) * plotHeight;
  const svg = createSvg(width, height, 'Sessions by requests and cost');
  for (let exponent = Math.log10(costFloor); exponent <= Math.log10(costCeil) + 1e-9; exponent++) {
    const y = logY(Math.pow(10, exponent));
    svg.append(svgNode('line', { x1: margin.left, x2: width - margin.right, y1: y, y2: y, class: exponent === Math.log10(costFloor) ? 'axis-line' : 'grid-line' }));
    svg.append(svgText(margin.left - 8, y + 4, formatUsd(Math.pow(10, exponent)), { class: 'tick', 'text-anchor': 'end' }));
  }
  for (let exponent = 0; Math.pow(10, exponent) <= maxRequests; exponent++) {
    svg.append(svgText(logX(Math.pow(10, exponent)), height - 16, formatCount(Math.pow(10, exponent)), { class: 'tick', 'text-anchor': 'middle' }));
  }
  svg.append(svgText(margin.left + plotWidth / 2, height - 2, 'requests per session (log)', { class: 'tick', 'text-anchor': 'middle' }));
  const ordered = [...points].sort((a, b) => b.cost - a.cost);
  for (const point of ordered) {
    const cx = logX(point.requests);
    const cy = logY(point.cost);
    const color = tierColor(point.tier);
    const mostlyEstimated = point.estimated > point.cost / 2;
    const muted = selected && !selected.has(point.key);
    const group = svgNode('g', { class: 'dot', tabindex: 0, role: 'button', opacity: muted ? 0.25 : 1 });
    group.append(svgNode('circle', { cx, cy, r: 12, class: 'dot-hit' }));
    group.append(
      svgNode(
        'circle',
        { cx, cy, r: mostlyEstimated ? 4 : 4.5, class: mostlyEstimated ? 'dot-estimated' : 'dot-measured' },
        mostlyEstimated ? `stroke: ${color}` : `fill: ${color}`,
      ),
    );
    const tip = (event: { clientX: number; clientY: number }) =>
      context.tooltip.show(event, point.title, [
        { label: 'Cost', value: approx(formatUsd(point.cost), point.estimated, point.cost), color, mark: mostlyEstimated ? 'hatch' : undefined },
        { label: 'Requests', value: formatCount(point.requests) },
        { label: 'Dominant tier', value: point.tier },
      ]);
    group.addEventListener('pointermove', tip);
    group.addEventListener('pointerleave', () => context.tooltip.hide());
    group.addEventListener('focus', () => {
      const bounds = group.getBoundingClientRect();
      tip({ clientX: bounds.left, clientY: bounds.top });
    });
    group.addEventListener('blur', () => context.tooltip.hide());
    const toggle = () => context.onPick({ kind: 'toggleKey', dim: 'session', key: point.key });
    group.addEventListener('click', toggle);
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    });
    svg.append(group);
  }
  const tiersPresent = [...new Set(points.map((point) => point.tier))].sort((a, b) => (TIER_SLOTS[a] ?? 9) - (TIER_SLOTS[b] ?? 9));
  host.append(
    legend([
      ...tiersPresent.map((tier) => ({ label: tier, color: tierColor(tier), shape: 'dot' as const })),
      ...(points.some((point) => point.estimated > point.cost / 2) ? [{ label: 'Mostly estimated cost', color: 'var(--text-muted)', shape: 'ring' as const }] : []),
    ]),
    svg,
  );
  return {
    columns: ['Session', 'Tier', 'Requests', 'Cost'],
    rows: ordered.map((point) => [point.title, point.tier, formatCount(point.requests), approx(formatUsd(point.cost), point.estimated, point.cost)]),
  };
}

function renderTopSessions(host: HTMLElement, context: ChartContext): TableView {
  const { cube, selection } = context;
  const bySession = selection.rollup('session');
  const selected = activeKeys(context.filters, 'session');
  const keys = bySession.keys.filter((key) => bySession.value(key, 'requests') > 0).slice(0, 25);
  const table = htmlNode('table', 'data-table sessions-table');
  const head = htmlNode('tr');
  const columns = ['Session', 'Tool', 'Project', 'Prompts', 'Requests', 'Cache hit', 'Cost'];
  for (const column of columns) head.append(htmlNode('th', column === 'Session' || column === 'Tool' || column === 'Project' ? '' : 'num', column));
  table.append(htmlNode('thead'));
  table.tHead!.append(head);
  const body = htmlNode('tbody');
  const rows: string[][] = [];
  for (const key of keys) {
    const info = cube.session(key);
    const side = INPUT_SIDE_KINDS.reduce((sum, kind) => sum + bySession.value(key, kind, 'measured'), 0);
    const hit = side > 0 ? formatPercent(bySession.value(key, 'cacheRead', 'measured') / side) : '';
    const cost = bySession.value(key, 'costUsd');
    const values = [
      info.title || info.id,
      info.tool,
      cube.labels('project')[info.projectKey],
      String(info.humanTurns),
      formatCount(bySession.value(key, 'requests')),
      hit,
      approx(formatUsd(cost), bySession.value(key, 'costUsd', 'estimated'), cost),
    ];
    rows.push(values);
    const row = htmlNode('tr', selected?.has(key) ? 'is-selected' : '');
    row.tabIndex = 0;
    values.forEach((value, index) => row.append(htmlNode('td', index >= 3 ? 'num' : index === 0 ? 'title-cell' : '', value)));
    const toggle = () => context.onPick({ kind: 'toggleKey', dim: 'session', key });
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    });
    body.append(row);
  }
  table.append(body);
  const scroller = htmlNode('div', 'table-scroll');
  scroller.append(table);
  host.append(scroller);
  return { columns, rows };
}

function tile(label: string, value: string, note?: string): HTMLElement {
  const node = htmlNode('div', 'stat-tile');
  node.append(htmlNode('div', 'stat-label', label), htmlNode('div', 'stat-value', value));
  if (note) node.append(htmlNode('div', 'stat-note', note));
  return node;
}

function renderKpis(host: HTMLElement, context: ChartContext): TableView {
  const { selection } = context;
  const total = selection.total();
  const cost = total.value('costUsd');
  const estimatedCost = total.value('costUsd', 'estimated');
  const allTokens = TOKEN_KINDS.reduce((sum, kind) => sum + total.value(kind), 0);
  const estimatedTokens = TOKEN_KINDS.reduce((sum, kind) => sum + total.value(kind, 'estimated'), 0);
  const side = INPUT_SIDE_KINDS.reduce((sum, kind) => sum + total.value(kind, 'measured'), 0);
  const hitRate = side > 0 ? total.value('cacheRead', 'measured') / side : 0;
  const bySession = selection.rollup('session');
  const sessions = bySession.keys.filter((key) => bySession.value(key, 'requests') > 0).length;
  const unpriced = total.value('unpricedTokens');
  const row = htmlNode('div', 'kpi-row');
  const costText = approx(formatUsd(cost), estimatedCost, cost);
  const perSession = approx(formatUsd(sessions ? cost / sessions : 0), estimatedCost, cost);
  row.append(
    tile('Cost', costText, estimatedCost > 0 ? `${formatUsd(estimatedCost)} estimated` : 'all measured'),
    tile('Tokens', approx(formatCount(allTokens), estimatedTokens, allTokens), unpriced > 0 ? `${formatCount(unpriced)} unpriced` : undefined),
    tile('Cache hit rate', formatPercent(hitRate), 'measured input side'),
    tile('Sessions', formatCount(sessions), `${formatCount(total.value('requests'))} requests`),
    tile('Cost per session', perSession),
  );
  host.append(row);
  return {
    columns: ['Metric', 'Value'],
    rows: [
      ['Cost', costText],
      ['Estimated cost', formatUsd(estimatedCost)],
      ['Tokens', formatCount(allTokens)],
      ['Cache hit rate', formatPercent(hitRate)],
      ['Sessions', String(sessions)],
      ['Cost per session', perSession],
    ],
  };
}

function fidelityText(counts: Readonly<Record<Fidelity, number>>): string {
  return (Object.entries(counts) as [Fidelity, number][])
    .filter(([, count]) => count > 0)
    .map(([fidelity, count]) => `${formatCount(count)} ${fidelity}`)
    .join(' · ') || 'no rows';
}

function sourceLine(report: SourceReport): string[] {
  if (report.status === 'failed') return [report.source, 'failed', report.error, '', ''];
  if (report.status === 'missing') {
    return [report.source, 'not found', report.lookedAt, '', report.filesRetained ? `${report.filesRetained} files · ${formatCount(report.retainedRequests)} requests` : '0'];
  }
  return [
    report.source,
    'ok',
    `${formatCount(report.requests)} requests in ${formatCount(report.sessions)} sessions (${report.filesParsed}/${report.filesSeen} files parsed)`,
    fidelityText(report.fidelity),
    report.filesRetained ? `${report.filesRetained} files · ${formatCount(report.retainedRequests)} requests` : '0',
  ];
}

function renderSources(host: HTMLElement, context: ChartContext): TableView {
  const columns = ['Source', 'Status', 'Detail', 'Fidelity', 'Retained after deletion'];
  const rows = context.cube.sources.map(sourceLine);
  const table = htmlNode('table', 'data-table');
  const head = htmlNode('tr');
  for (const column of columns) head.append(htmlNode('th', '', column));
  table.append(htmlNode('thead'));
  table.tHead!.append(head);
  const body = htmlNode('tbody');
  for (const values of rows) {
    const row = htmlNode('tr');
    values.forEach((value, index) => {
      const cell = htmlNode('td', index === 1 ? `status status-${value.replace(/\s/g, '-')}` : '', value);
      row.append(cell);
    });
    body.append(row);
  }
  table.append(body);
  const notes = context.cube.sources.flatMap((report) => (report.status === 'ok' ? report.notes.map((note) => `${report.source}: ${note}`) : []));
  const footer = htmlNode('div', 'sources-footer');
  footer.append(htmlNode('span', 'muted', `Snapshot built ${new Date(context.cube.builtAt).toLocaleString()}`));
  const rebuild = htmlNode('button', 'button', 'Rebuild');
  rebuild.addEventListener('click', () => context.onRebuild());
  footer.append(rebuild);
  const scroller = htmlNode('div', 'table-scroll');
  scroller.append(table);
  host.append(scroller);
  for (const note of notes) host.append(htmlNode('p', 'muted small', note));
  host.append(footer);
  return { columns, rows };
}

export const CHARTS: readonly ChartSpec[] = [
  { id: 'kpis', title: 'Summary', subtitle: '≈ marks figures with an estimated part', span: 'full', ownDims: () => [], render: renderKpis },
  { id: 'dailyCost', title: 'Cost per day', subtitle: 'Drag to select days · click a segment to filter', span: 'full', ownDims: (stackBy) => ['day', stackBy], render: renderDailyCost },
  { id: 'tokenMix', title: 'Token mix by week', subtitle: 'Share of disjoint token kinds · click a week to filter', span: 'half', ownDims: () => ['week'], render: renderTokenMix },
  { id: 'cacheHitByWeek', title: 'Cache hit rate by week', subtitle: 'Cache read ÷ input-side tokens, measured only', span: 'half', ownDims: () => ['week', 'tool'], render: renderCacheHitByWeek },
  { id: 'costByProject', title: 'Cost by project', subtitle: 'Click a bar to filter', span: 'half', ownDims: () => ['project'], render: (host, context) => renderRankedBars(host, context, 'project', 15) },
  { id: 'costByModel', title: 'Cost by model', subtitle: 'Click a bar to filter', span: 'half', ownDims: () => ['model'], render: (host, context) => renderRankedBars(host, context, 'model', 12) },
  { id: 'sessionScatter', title: 'Sessions', subtitle: 'Requests vs cost, colored by dominant model tier · click to select', span: 'half', ownDims: () => ['session'], render: renderSessionScatter },
  { id: 'topSessions', title: 'Most expensive sessions', subtitle: 'Click a row to select the session', span: 'half', ownDims: () => ['session'], render: renderTopSessions },
  { id: 'sources', title: 'Sources', subtitle: 'Where the data came from and how exact it is', span: 'full', ownDims: () => [], render: renderSources },
];
