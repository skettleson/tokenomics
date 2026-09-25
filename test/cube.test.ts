import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSnapshot } from '../compile/compile.ts';
import type { Harvest, SessionFact, UsageFact } from '../compile/compile.ts';
import { tokens } from '../shared/snapshot.ts';
import type { Fidelity, TokenKind, Tool } from '../shared/snapshot.ts';
import { decodeFilters, encodeFilters, loadCube, setRange, toggleKey, unionFilters } from '../web/cube.ts';
import type { Cube, Dim } from '../web/cube.ts';

function session(key: string, tool: Tool, projectPath: string | null): SessionFact {
  return { key, tool, kind: 'conversation', projectPath, title: key, humanTurns: 1 };
}

function usage(key: string, sessionKey: string, at: string, model: string, fidelity: Fidelity, partial: Partial<Record<TokenKind, number>>): UsageFact {
  return { key, sessionKey, atMs: Date.parse(at), model, speed: 'standard', agent: 'main', fidelity, tokens: tokens(partial), reportedCostUsd: null };
}

const report = { source: 'claude-code', tool: 'claude-code', status: 'missing', lookedAt: '/nowhere', filesRetained: 0, retainedRequests: 0 } as const;

const harvests: Harvest[] = [
  {
    source: 'claude-code',
    sessions: [session('s1', 'claude-code', '/Users/me/a'), session('s2', 'claude-code', '/Users/me/b')],
    usage: [
      usage('r1', 's1', '2026-09-01T10:00:00Z', 'claude-opus-5', 'measured', { input: 1_000_000 }),
      usage('r2', 's1', '2026-09-02T03:00:00Z', 'claude-sonnet-5', 'measured', { output: 1_000_000 }),
      usage('r3', 's2', '2026-09-02T12:00:00Z', 'claude-opus-5', 'measured', { cacheRead: 2_000_000 }),
    ],
    report,
  },
  {
    source: 'cursor',
    sessions: [session('c1', 'cursor', null)],
    usage: [
      usage('r4', 'c1', '2026-09-08T09:00:00Z', 'grok-4.5', 'estimated', { input: 1_000_000 }),
      usage('r5', 'c1', '2026-09-08T09:05:00Z', 'cursor-default', 'estimated', { input: 500 }),
    ],
    report: { ...report, source: 'cursor', tool: 'cursor' },
  },
];

function fixtureCube(timeZone = 'UTC'): Cube {
  return loadCube(encodeSnapshot(harvests, new Date('2026-09-10T00:00:00Z'), '/Users/me'), { timeZone });
}

function keyOf(cube: Cube, dim: Dim, label: string): number {
  return cube.labels(dim).indexOf(label);
}

function labelled(cube: Cube, dim: Dim, keys: readonly number[]): string[] {
  return keys.map((key) => cube.labels(dim)[key]);
}

test('totals split cost into measured and estimated basis and surface unpriced tokens', () => {
  const total = fixtureCube().select({}).total();
  assert.deepEqual(
    [total.value('costUsd'), total.value('costUsd', 'measured'), total.value('costUsd', 'estimated'), total.value('unpricedTokens'), total.value('requests')],
    [19, 16, 3, 500, 5],
  );
  assert.deepEqual([total.value('input', 'measured'), total.value('input', 'estimated')], [1_000_000, 1_000_500]);
});

test('crossfilter: a chart ignores filters on its own dimension but not on others', () => {
  const cube = fixtureCube();
  const selection = cube.select({ project: { kind: 'keys', keys: new Set([keyOf(cube, 'project', '~/a')]) } });
  const byProject = selection.without(['project']).rollup('project');
  assert.deepEqual(
    byProject.keys.map((key) => [cube.labels('project')[key], byProject.value(key, 'costUsd')]),
    [
      ['~/a', 15],
      ['(unknown)', 3],
      ['~/b', 1],
    ],
  );
  const byModel = selection.rollup('model');
  assert.deepEqual(
    byModel.keys.map((key) => [cube.labels('model')[key], byModel.value(key, 'costUsd')]),
    [
      ['claude-sonnet-5', 10],
      ['claude-opus-5', 5],
    ],
  );
});

test('rollup sums equal the selection total and the row count', () => {
  const cube = fixtureCube();
  const selection = cube.select({ tool: { kind: 'keys', keys: new Set([0]) } });
  const byDay = selection.rollup('day');
  const summed = byDay.keys.reduce((sum, key) => sum + byDay.value(key, 'costUsd'), 0);
  assert.deepEqual([summed, selection.total().value('costUsd'), selection.rows().length], [16, 16, 3]);
});

test('ordinal dimensions are dense calendar days and Monday weeks in the viewer time zone', () => {
  const utc = fixtureCube('UTC');
  assert.deepEqual([utc.labels('day')[0], utc.labels('day').length, utc.labels('week')], ['2026-09-01', 8, ['2026-08-31', '2026-09-07']]);
  const chicago = fixtureCube('America/Chicago');
  const byDay = chicago.select({}).rollup('day');
  assert.deepEqual(
    byDay.keys.filter((key) => byDay.value(key, 'requests') > 0).map((key) => [chicago.labels('day')[key], byDay.value(key, 'requests')]),
    [
      ['2026-09-01', 2],
      ['2026-09-02', 1],
      ['2026-09-08', 2],
    ],
  );
});

test('rollup2 stacks cost per day by tool with the basis kept per cell', () => {
  const cube = fixtureCube();
  const stack = cube.select({}).rollup2('day', 'tool');
  const day8 = keyOf(cube, 'day', '2026-09-08');
  const cursor = keyOf(cube, 'tool', 'cursor');
  const claude = keyOf(cube, 'tool', 'claude-code');
  assert.deepEqual(labelled(cube, 'tool', stack.inner), ['claude-code', 'cursor']);
  assert.deepEqual(
    [stack.value(day8, cursor, 'costUsd', 'estimated'), stack.value(day8, cursor, 'costUsd', 'measured'), stack.value(day8, claude, 'costUsd')],
    [3, 0, 0],
  );
});

test('filters round-trip through the URL hash by label', () => {
  const cube = fixtureCube();
  let filters = toggleKey({}, 'project', keyOf(cube, 'project', '~/a'));
  filters = toggleKey(filters, 'project', keyOf(cube, 'project', '~/b'));
  filters = setRange(filters, 'day', { from: 0, toExclusive: 2 });
  const hash = encodeFilters(cube, filters);
  assert.equal(hash, 'project=~%2Fa,~%2Fb&day=2026-09-01..2026-09-02');
  const decoded = decodeFilters(cube, `#${hash}`);
  assert.equal(cube.select(decoded).total().value('costUsd'), 16);
  assert.deepEqual(toggleKey(toggleKey({}, 'tool', 1), 'tool', 1), {});
});

test('narrow intersects evidence with the current selection', () => {
  const cube = fixtureCube();
  const selection = cube.select({ tool: { kind: 'keys', keys: new Set([0]) } });
  const narrowed = selection.narrow({ model: { kind: 'keys', keys: new Set([keyOf(cube, 'model', 'claude-opus-5'), keyOf(cube, 'model', 'grok-4.5')]) } });
  assert.equal(narrowed.total().value('costUsd'), 6);
});

test('unionFilters merges key sets per dimension and refuses what it cannot merge', () => {
  const s1 = { session: { kind: 'keys' as const, keys: new Set([1]) } };
  const s2 = { session: { kind: 'keys' as const, keys: new Set([2, 1]) } };
  assert.deepEqual(unionFilters([s1, s2]), { session: { kind: 'keys', keys: new Set([1, 2]) } });
  assert.equal(unionFilters([s1, { project: { kind: 'keys', keys: new Set([1]) } }]), null);
  assert.equal(unionFilters([s1, { ...s1, project: { kind: 'keys', keys: new Set([1]) } }]), null);
  assert.equal(unionFilters([{ week: { kind: 'range', from: 0, toExclusive: 2 } }, { week: { kind: 'keys', keys: new Set([3]) } }]), null);
  assert.equal(unionFilters([]), null);
});
