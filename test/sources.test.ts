import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createCompiler, supersedeEstimatesByMeasuredDays, normalizeProject } from '../compile/compile.ts';
import type { Harvest, UsageFact } from '../compile/compile.ts';
import { parseClaudeTranscript, claudeCodeSource } from '../compile/sources/claude.ts';
import { codexDeltaTokens, parseCodexRollout } from '../compile/sources/codex.ts';
import { estimateComposerUsage, readComposers } from '../compile/sources/cursor.ts';
import { measuredUsageFromExport, parseUsageExportCsv } from '../compile/sources/cursor-csv.ts';
import { TOKEN_KINDS, tokens } from '../shared/snapshot.ts';

const fixtures = join(import.meta.dirname, 'fixtures');

function assistantLine(id: string, output: number, timestamp: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'assistant',
    sessionId: 's1',
    timestamp,
    cwd: '/Users/me/code/app/.claude/worktrees/brave-otter',
    isSidechain: false,
    requestId: `req-${id}`,
    message: {
      id,
      model: 'claude-opus-5',
      usage: {
        input_tokens: 10,
        output_tokens: output,
        cache_creation_input_tokens: 300,
        cache_read_input_tokens: 5000,
        cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 },
        speed: 'standard',
      },
    },
    ...extra,
  });
}

const claudeTranscript = [
  JSON.stringify({ type: 'user', sessionId: 's1', uuid: 'u1', cwd: '/Users/me/code/app', message: { content: 'build the thing' } }),
  assistantLine('msg_a', 7, '2026-09-01T10:00:00.000Z'),
  assistantLine('msg_a', 133, '2026-09-01T10:00:01.000Z'),
  JSON.stringify({ type: 'user', sessionId: 's1', uuid: 'u2', message: { content: [{ type: 'tool_result', content: 'ok' }] } }),
  assistantLine('msg_b', 40, '2026-09-01T10:00:05.000Z', { message: { id: 'msg_b', model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 } } }),
  assistantLine('msg_c', 50, '2026-09-01T10:01:00.000Z'),
  JSON.stringify({ type: 'ai-title', sessionId: 's1', aiTitle: 'Generated title' }),
  JSON.stringify({ type: 'custom-title', sessionId: 's1', customTitle: 'My title' }),
  JSON.stringify({ type: 'ai-title', sessionId: 's1', aiTitle: 'Later generated title' }),
  'not json',
].join('\n');

test('claude transcript dedupes streamed lines by message id and keeps the final output count', () => {
  const part = parseClaudeTranscript(claudeTranscript, false);
  assert.deepEqual(
    part.usage.map((fact) => [fact.key, fact.atMs, fact.tokens.output, fact.tokens.cacheWrite5m, fact.tokens.cacheWrite1h, fact.agent]),
    [
      ['claude-code:msg_a', Date.parse('2026-09-01T10:00:00.000Z'), 133, 100, 200, 'main'],
      ['claude-code:msg_c', Date.parse('2026-09-01T10:01:00.000Z'), 50, 100, 200, 'main'],
    ],
  );
  assert.deepEqual(part.sessions, [
    {
      key: 'claude-code:s1',
      tool: 'claude-code',
      kind: 'conversation',
      projectPath: '/Users/me/code/app',
      title: 'My title',
      titleRank: 2,
      humanTurnIds: ['u1'],
    },
  ]);
});

test('claude lines in subagent files are attributed to the subagent', () => {
  const part = parseClaudeTranscript(assistantLine('msg_z', 3, '2026-09-01T10:00:00.000Z', { isSidechain: true }), true);
  assert.deepEqual(part.usage.map((fact) => [fact.sessionKey, fact.agent]), [['claude-code:s1', 'subagent']]);
});

test('project paths collapse home and claude worktrees', () => {
  assert.equal(normalizeProject('/Users/me/code/app/.claude/worktrees/brave-otter', '/Users/me'), '~/code/app');
  assert.equal(normalizeProject('/opt/work/', '/Users/me'), '/opt/work');
  assert.equal(normalizeProject(null, '/Users/me'), '(unknown)');
});

function codexLine(type: string, payload: Record<string, unknown>, timestamp = '2026-09-02T08:00:00.000Z'): string {
  return JSON.stringify({ timestamp, type, payload });
}

function tokenCount(total: Record<string, number>, timestamp: string): string {
  return codexLine('event_msg', { type: 'token_count', info: { total_token_usage: total } }, timestamp);
}

test('codex rollout takes deltas of cumulative usage and normalizes overlapping OpenAI kinds', () => {
  const text = [
    codexLine('session_meta', { id: 'thread-1', cwd: '/Users/me/code/app' }),
    codexLine('turn_context', { model: 'gpt-5.6-sol' }),
    codexLine('event_msg', { type: 'user_message' }),
    tokenCount({ input_tokens: 1000, cached_input_tokens: 600, output_tokens: 300, reasoning_output_tokens: 100, total_tokens: 1300 }, '2026-09-02T08:00:01.000Z'),
    tokenCount({ input_tokens: 1000, cached_input_tokens: 600, output_tokens: 300, reasoning_output_tokens: 100, total_tokens: 1300 }, '2026-09-02T08:00:02.000Z'),
    tokenCount({ input_tokens: 2500, cached_input_tokens: 1800, output_tokens: 500, reasoning_output_tokens: 150, total_tokens: 3000 }, '2026-09-02T08:00:03.000Z'),
    codexLine('event_msg', { type: 'token_count', info: null }),
  ].join('\n');
  const part = parseCodexRollout(text);
  assert.deepEqual(
    part.usage.map((fact) => [fact.key, fact.model, fact.fidelity, fact.tokens]),
    [
      ['codex:thread-1:1300', 'gpt-5.6-sol', 'measured', tokens({ input: 400, cacheRead: 600, output: 200, reasoning: 100 })],
      ['codex:thread-1:3000', 'gpt-5.6-sol', 'measured', tokens({ input: 300, cacheRead: 1200, output: 150, reasoning: 50 })],
    ],
  );
  assert.equal(part.sessions[0].humanTurnIds.length, 1);
});

test('codex imports with only total_tokens become total-only unsplit tokens', () => {
  const text = [
    codexLine('session_meta', { id: 'imported', cwd: '/Users/me/EzNotes' }),
    tokenCount({ input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 32834 }, '2026-07-20T14:52:56.620Z'),
  ].join('\n');
  const [fact] = parseCodexRollout(text).usage;
  assert.deepEqual([fact.model, fact.fidelity, fact.tokens], ['codex-unknown-model', 'total-only', tokens({ unsplit: 32834 })]);
});

test('codex normalization never produces negative token kinds', () => {
  const zero = { input_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0 };
  const inconsistent = { input_tokens: 100, cached_input_tokens: 250, cache_write_input_tokens: 80, output_tokens: 20, reasoning_output_tokens: 90, total_tokens: 120 };
  const { tokens: vector } = codexDeltaTokens(zero, inconsistent);
  assert.deepEqual(vector, tokens({ input: 0, cacheRead: 100, cacheWrite5m: 0, output: 0, reasoning: 20 }));
});

test('cursor composer bubbles become estimated requests from running context size', () => {
  const part = estimateComposerUsage({
    composerId: 'c1',
    name: 'Refactor sidebar',
    modelName: 'claude-sonnet-5-thinking-high',
    createdAtMs: Date.parse('2026-09-03T09:00:00.000Z'),
    bubbles: [
      { bubbleId: 'b2', role: 'assistant', createdAtMs: Date.parse('2026-09-03T09:00:10.000Z'), replyChars: 400, contextChars: 4400, reportedInput: 0, reportedOutput: 0, workspaceUri: 'file:///Users/me/log%20analyzer' },
      { bubbleId: 'b1', role: 'user', createdAtMs: Date.parse('2026-09-03T09:00:00.000Z'), replyChars: 800, contextChars: 800, reportedInput: 0, reportedOutput: 0, workspaceUri: null },
      { bubbleId: 'b3', role: 'assistant', createdAtMs: Date.parse('2026-09-03T09:00:20.000Z'), replyChars: 10, contextChars: 10, reportedInput: 17550, reportedOutput: 5914, workspaceUri: null },
    ],
  });
  assert.deepEqual(
    part.usage.map((fact) => [fact.key, fact.fidelity, fact.tokens.input, fact.tokens.output]),
    [
      ['cursor:c1:b2', 'estimated', 200, 100],
      ['cursor:c1:b3', 'measured', 17550, 5914],
    ],
  );
  assert.deepEqual([part.sessions[0].projectPath, part.sessions[0].title, part.sessions[0].humanTurnIds], ['/Users/me/log analyzer', 'Refactor sidebar', ['b1']]);
});

test('cursor state database rows become per-bubble estimates in bubble order', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tokenomics-cursor-test-'));
  const path = join(directory, 'state.vscdb');
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value BLOB)');
  const insert = db.prepare('INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)');
  insert.run('composerData:c9', JSON.stringify({ name: 'Chat', createdAt: 1_700_000_000_000, modelConfig: { modelName: 'default' } }));
  insert.run('bubbleId:c9:b1', JSON.stringify({ type: 1, createdAt: '2026-09-03T09:00:00.000Z', text: 'x'.repeat(40) }));
  insert.run('bubbleId:c9:b2', JSON.stringify({ type: 2, createdAt: '2026-09-03T09:00:01.000Z', text: 'y'.repeat(12), toolFormerData: { result: 'z'.repeat(100) }, tokenCount: { inputTokens: 0, outputTokens: 0 } }));
  insert.run('bubbleId:c9:b3', JSON.stringify({ type: 2, createdAt: '2026-09-03T09:00:02.000Z', text: 'w'.repeat(8) }));
  insert.run('unrelated', '{}');
  db.close();
  try {
    const part = estimateComposerUsage(readComposers(path)[0]);
    assert.deepEqual(
      part.usage.map((fact) => [fact.model, fact.tokens.input, fact.tokens.output]),
      [
        ['cursor-default', 10, 3],
        ['cursor-default', 38, 2],
      ],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('cursor usage CSV rows become measured billing-day requests with reported cost', async () => {
  const part = measuredUsageFromExport(parseUsageExportCsv(await readFile(join(fixtures, 'cursor-usage.csv'), 'utf8')));
  assert.deepEqual(
    part.usage.map((fact) => [fact.sessionKey, fact.model, fact.fidelity, fact.tokens.input, fact.tokens.cacheWrite5m, fact.tokens.cacheRead, fact.tokens.output, fact.reportedCostUsd]),
    [
      ['cursor-csv:2026-09-20', 'claude-sonnet-5-thinking-high', 'measured', 3000, 12000, 40000, 2500, 0.21],
      ['cursor-csv:2026-09-20', 'gpt-5.6-sol-medium', 'measured', 8000, 0, 0, 1000, null],
      ['cursor-csv:2026-09-21', 'claude-opus-4-8-thinking-high', 'measured', 1000, 20000, 100000, 4000, 1.5],
    ],
  );
  assert.deepEqual(part.sessions.map((session) => [session.key, session.kind]), [
    ['cursor-csv:2026-09-20', 'billingDay'],
    ['cursor-csv:2026-09-21', 'billingDay'],
  ]);
});

function estimate(key: string, atIso: string): UsageFact {
  return {
    key,
    sessionKey: 'cursor:c1',
    atMs: Date.parse(atIso),
    model: 'composer-2.5-fast',
    speed: 'standard',
    agent: 'main',
    fidelity: 'estimated',
    tokens: tokens({ input: 100 }),
    reportedCostUsd: null,
  };
}

test('imported CSV days supersede cursor estimates on the same day only', async () => {
  const csv = measuredUsageFromExport(parseUsageExportCsv(await readFile(join(fixtures, 'cursor-usage.csv'), 'utf8')));
  const report = { source: 'cursor', tool: 'cursor', status: 'ok', filesSeen: 1, filesParsed: 1, filesRetained: 0, sessions: 1, requests: 2, retainedRequests: 0, fidelity: { measured: 0, 'total-only': 0, estimated: 2 }, notes: [] } as const;
  const harvests: Harvest[] = [
    {
      source: 'cursor',
      sessions: [{ key: 'cursor:c1', tool: 'cursor', kind: 'conversation', projectPath: null, title: null, humanTurns: 1 }],
      usage: [estimate('cursor:c1:a', '2026-09-20T12:00:00.000Z'), estimate('cursor:c1:b', '2026-09-22T12:00:00.000Z')],
      report: { ...report, notes: [] },
    },
    { source: 'cursor-csv', sessions: [], usage: csv.usage, report: { ...report, source: 'cursor-csv', notes: [] } },
  ];
  const [cursor] = supersedeEstimatesByMeasuredDays(harvests);
  assert.deepEqual(cursor.usage.map((fact) => fact.key), ['cursor:c1:b']);
  assert.deepEqual(cursor.report.status === 'ok' && cursor.report.notes, ['1 estimated requests superseded by imported usage CSV']);
});

test('rows of transcripts that vanish from disk are retained in the memo', async () => {
  const home = await mkdtemp(join(tmpdir(), 'tokenomics-retain-'));
  const project = join(home, '.claude', 'projects', '-Users-me-code-app');
  await mkdir(project, { recursive: true });
  await writeFile(join(project, 's1.jsonl'), claudeTranscript);
  await writeFile(join(project, 's2.jsonl'), assistantLine('msg_d', 9, '2026-09-04T10:00:00.000Z', { sessionId: 's2' }));
  const env = { home, importsDir: join(home, 'imports'), memoPath: join(home, 'memo.json') };
  try {
    const first = await createCompiler(env, [claudeCodeSource]).compile();
    await rm(join(project, 's1.jsonl'));
    const second = await createCompiler(env, [claudeCodeSource]).compile();
    assert.equal(first.requests.atSec.length, 3);
    assert.equal(second.requests.atSec.length, 3);
    const [report] = second.sources;
    assert.equal(report.status, 'ok');
    assert.deepEqual(report.status === 'ok' && [report.filesSeen, report.filesParsed, report.filesRetained, report.retainedRequests], [1, 0, 1, 2]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('every parsed fixture row has non-negative disjoint token kinds', async () => {
  const csv = measuredUsageFromExport(parseUsageExportCsv(await readFile(join(fixtures, 'cursor-usage.csv'), 'utf8')));
  const rows = [...parseClaudeTranscript(claudeTranscript, false).usage, ...csv.usage];
  const negatives = rows.flatMap((fact) => TOKEN_KINDS.filter((kind) => fact.tokens[kind] < 0).map((kind) => `${fact.key}.${kind}`));
  assert.deepEqual([rows.length, negatives], [5, []]);
});
