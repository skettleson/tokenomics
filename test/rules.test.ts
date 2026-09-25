import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSnapshot } from '../compile/compile.ts';
import type { Harvest, SessionFact, UsageFact } from '../compile/compile.ts';
import { tokens } from '../shared/snapshot.ts';
import type { Fidelity, Speed, TokenKind, Tool } from '../shared/snapshot.ts';
import { loadCube } from '../web/cube.ts';
import { groupFindings, RULES } from '../web/rules.ts';
import type { Finding, RuleId } from '../web/rules.ts';

type Row = {
  session: string;
  at?: string;
  model?: string;
  fidelity?: Fidelity;
  speed?: Speed;
  tokens: Partial<Record<TokenKind, number>>;
};

type SessionSpec = { key: string; tool?: Tool; project?: string; humanTurns?: number };

const NOW = new Date('2026-09-28T12:00:00Z');

function run(rule: RuleId, sessions: readonly SessionSpec[], rows: readonly Row[]) {
  const sessionFacts: SessionFact[] = sessions.map((spec) => ({
    key: spec.key,
    tool: spec.tool ?? 'claude-code',
    kind: 'conversation',
    projectPath: spec.project ?? '/Users/me/a',
    title: spec.key,
    humanTurns: spec.humanTurns ?? 5,
  }));
  const usage: UsageFact[] = rows.map((row, index) => ({
    key: `r${index}`,
    sessionKey: row.session,
    atMs: Date.parse(row.at ?? '2026-09-22T10:00:00Z') + (row.at ? 0 : index * 1000),
    model: row.model ?? 'claude-opus-5',
    speed: row.speed ?? 'standard',
    agent: 'main',
    fidelity: row.fidelity ?? 'measured',
    tokens: tokens(row.tokens),
    reportedCostUsd: null,
  }));
  const harvest: Harvest = {
    source: 'claude-code',
    sessions: sessionFacts,
    usage,
    report: { source: 'claude-code', tool: 'claude-code', status: 'missing', lookedAt: '/nowhere', filesRetained: 0, retainedRequests: 0 },
  };
  const cube = loadCube(encodeSnapshot([harvest], NOW, '/Users/me'), { timeZone: 'UTC' });
  return RULES[rule]({ cube, selection: cube.select({}), now: NOW }).map((finding) => ({
    subject: finding.subject,
    value: Number(finding.metric.value.toFixed(4)),
    threshold: finding.metric.threshold,
    impactUsd: finding.impactUsd === null ? null : Number(finding.impactUsd.toFixed(2)),
    basis: finding.basis,
  }));
}

const one = [{ key: 's1' }];

test('lowCacheHit fires on a project that misses the cache and stays silent on a cached one', () => {
  assert.deepEqual(run('lowCacheHit', one, [{ session: 's1', tokens: { input: 15_000_000, cacheRead: 5_000_000 } }]), [
    { subject: '~/a', value: 0.25, threshold: 0.8, impactUsd: null, basis: 'measured' },
  ]);
  assert.deepEqual(run('lowCacheHit', one, [{ session: 's1', tokens: { input: 1_000_000, cacheRead: 19_000_000 } }]), []);
});

test('cacheWriteChurn fires when writes are large relative to reads', () => {
  assert.deepEqual(run('cacheWriteChurn', one, [{ session: 's1', tokens: { cacheWrite5m: 10_000_000, cacheRead: 20_000_000 } }]), [
    { subject: '~/a', value: 0.5, threshold: 0.12, impactUsd: 62.5, basis: 'measured' },
  ]);
  assert.deepEqual(run('cacheWriteChurn', one, [{ session: 's1', tokens: { cacheWrite5m: 1_000_000, cacheRead: 50_000_000 } }]), []);
});

test('premiumShortSessions quotes the downshift savings', () => {
  const sessions = ['p1', 'p2', 'p3', 'p4', 'p5'].map((key) => ({ key, humanTurns: 1 }));
  const premium = sessions.map((session) => ({ session: session.key, tokens: { output: 100_000 } }));
  assert.deepEqual(run('premiumShortSessions', sessions, premium), [{ subject: '5 sessions', value: 5, threshold: 5, impactUsd: 7.5, basis: 'measured' }]);
  const standard = premium.map((row) => ({ ...row, model: 'claude-sonnet-5' }));
  assert.deepEqual(run('premiumShortSessions', sessions, standard), []);
});

test('runawaySession fires on a session far above the median', () => {
  const sessions = ['a', 'b', 'c', 'd', 'big'].map((key) => ({ key }));
  const small = ['a', 'b', 'c', 'd'].map((session) => ({ session, tokens: { input: 200_000 } }));
  assert.deepEqual(run('runawaySession', sessions, [...small, { session: 'big', tokens: { input: 40_000_000 } }]), [
    { subject: 'big', value: 200, threshold: 150, impactUsd: 199, basis: 'measured' },
  ]);
  assert.deepEqual(run('runawaySession', sessions, [...small, { session: 'big', tokens: { input: 200_000 } }]), []);
});

test('contextBloat fires when every request re-sends a huge context', () => {
  const heavy = Array.from({ length: 30 }, () => ({ session: 's1', tokens: { cacheRead: 390_000, input: 10_000 } }));
  assert.deepEqual(run('contextBloat', one, heavy), [{ subject: 's1', value: 400_000, threshold: 320_000, impactUsd: null, basis: 'measured' }]);
  const light = heavy.map((row) => ({ ...row, tokens: { cacheRead: 90_000, input: 10_000 } }));
  assert.deepEqual(run('contextBloat', one, light), []);
});

test('outputHeavySession fires when output dominates the session cost', () => {
  assert.deepEqual(run('outputHeavySession', one, [{ session: 's1', tokens: { input: 1_000_000, output: 1_000_000 } }]), [
    { subject: 's1', value: 0.8333, threshold: 0.3, impactUsd: 25, basis: 'measured' },
  ]);
  assert.deepEqual(run('outputHeavySession', one, [{ session: 's1', tokens: { input: 5_000_000, output: 100_000 } }]), []);
});

test('premiumShareRising compares the last complete week with the prior three', () => {
  const baseline = ['2026-09-01T10:00:00Z', '2026-09-08T10:00:00Z', '2026-09-15T10:00:00Z'].map((at) => ({
    session: 's1',
    at,
    model: 'claude-sonnet-5',
    tokens: { input: 15_000_000 },
  }));
  const lastWeekPremium = [
    { session: 's1', at: '2026-09-22T10:00:00Z', tokens: { input: 5_000_000 } },
    { session: 's1', at: '2026-09-23T10:00:00Z', model: 'claude-sonnet-5', tokens: { input: 2_500_000 } },
  ];
  assert.deepEqual(run('premiumShareRising', one, [...baseline, ...lastWeekPremium]), [
    { subject: 'week of 2026-09-21', value: 0.8333, threshold: 0.15, impactUsd: null, basis: 'measured' },
  ]);
  const lastWeekStandard = lastWeekPremium.map((row) => ({ ...row, model: 'claude-sonnet-5' }));
  assert.deepEqual(run('premiumShareRising', one, [...baseline, ...lastWeekStandard]), []);
});

test('fastModePremium fires when fast mode is a large share of cost', () => {
  const standard = { session: 's1', tokens: { input: 4_000_000 } };
  assert.deepEqual(run('fastModePremium', one, [standard, { session: 's1', speed: 'fast', tokens: { input: 2_000_000 } }]), [
    { subject: 'fast-mode requests', value: 0.5, threshold: 0.15, impactUsd: 10, basis: 'measured' },
  ]);
  assert.deepEqual(run('fastModePremium', one, [standard, { session: 's1', tokens: { input: 2_000_000 } }]), []);
});

test('cacheExpiryRewrites fires when the cache is rewritten after an idle gap', () => {
  const first = { session: 's1', at: '2026-09-22T10:00:00Z', tokens: { cacheWrite5m: 100_000 } };
  assert.deepEqual(run('cacheExpiryRewrites', one, [first, { session: 's1', at: '2026-09-22T10:10:00Z', tokens: { cacheWrite5m: 4_000_000 } }]), [
    { subject: 's1', value: 23, threshold: 15, impactUsd: 23, basis: 'measured' },
  ]);
  assert.deepEqual(run('cacheExpiryRewrites', one, [first, { session: 's1', at: '2026-09-22T10:01:00Z', tokens: { cacheWrite5m: 4_000_000 } }]), []);
});

test('pricingGaps flags unpriced models and placeholder-heavy cost', () => {
  assert.deepEqual(
    run('pricingGaps', one, [
      { session: 's1', model: 'mystery-model', tokens: { input: 500 } },
      { session: 's1', model: 'grok-4.5', tokens: { input: 1_000_000 } },
    ]),
    [
      { subject: 'mystery-model', value: 500, threshold: 1, impactUsd: null, basis: 'measured' },
      { subject: 'grok-4.5', value: 1, threshold: 0.1, impactUsd: 3, basis: 'estimated' },
    ],
  );
  assert.deepEqual(run('pricingGaps', one, [{ session: 's1', tokens: { input: 1_000_000 } }]), []);
});

test('cursorEstimatesOnly fires only when Cursor has no measured usage', () => {
  const cursor = [{ key: 'c1', tool: 'cursor' as const }];
  const estimated = { session: 'c1', model: 'composer-2.5-fast', fidelity: 'estimated' as const, tokens: { input: 100 } };
  assert.deepEqual(run('cursorEstimatesOnly', cursor, [estimated, estimated]), [
    { subject: 'cursor', value: 1, threshold: 0.99, impactUsd: null, basis: 'estimated' },
  ]);
  assert.deepEqual(run('cursorEstimatesOnly', cursor, [estimated, { ...estimated, fidelity: 'measured' }]), []);
});

function finding(rule: RuleId, subject: string, severity: Finding['severity'], impactUsd: number | null, basis: Finding['basis'], session: number): Finding {
  return {
    rule,
    title: rule,
    severity,
    subject,
    metric: { name: 'm', value: 1, comparator: '>=', threshold: 1, unit: 'usd' },
    impactUsd,
    basis,
    advice: subject,
    evidence: { session: { kind: 'keys', keys: new Set([session]) } },
    focus: 'topSessions',
  };
}

test('groupFindings collapses findings of one rule into a group ordered by severity then impact', () => {
  const groups = groupFindings([
    finding('outputHeavySession', 'o1', 'low', 500, 'measured', 9),
    finding('runawaySession', 'r1', 'medium', 200, 'measured', 1),
    finding('runawaySession', 'r2', 'high', 300, 'estimated', 2),
  ]);
  assert.deepEqual(
    groups.map((group) => ({
      rule: group.rule,
      subjects: group.findings.map((member) => member.subject),
      severity: group.severity,
      totalImpactUsd: group.totalImpactUsd,
      basis: group.basis,
      action: group.action,
      evidence: group.evidence,
    })),
    [
      {
        rule: 'runawaySession',
        subjects: ['r2', 'r1'],
        severity: 'high',
        totalImpactUsd: 500,
        basis: 'estimated',
        action: 'Split long tasks into fresh sessions and compact earlier.',
        evidence: { session: { kind: 'keys', keys: new Set([2, 1]) } },
      },
      {
        rule: 'outputHeavySession',
        subjects: ['o1'],
        severity: 'low',
        totalImpactUsd: 500,
        basis: 'measured',
        action: 'Ask for diffs instead of whole files and lower effort for routine edits.',
        evidence: { session: { kind: 'keys', keys: new Set([9]) } },
      },
    ],
  );
});

test('groupFindings reports a null total when no member has an impact', () => {
  const groups = groupFindings([finding('contextBloat', 'a', 'medium', null, 'measured', 1), finding('contextBloat', 'b', 'medium', null, 'measured', 2)]);
  assert.deepEqual(groups.map((group) => [group.findings.length, group.totalImpactUsd]), [[2, null]]);
});
