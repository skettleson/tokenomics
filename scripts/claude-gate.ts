import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCompiler } from '../compile/compile.ts';
import { claudeCodeSource } from '../compile/sources/claude.ts';
import { priceRow, resolvePrice } from '../shared/prices.ts';
import { SPEEDS, TOKEN_KINDS, TOOLS } from '../shared/snapshot.ts';
import type { TokenKind } from '../shared/snapshot.ts';

const frozenHome = await mkdtemp(join(tmpdir(), 'tokenomics-gate-'));
await mkdir(join(frozenHome, '.claude'));
execFileSync('cp', ['-cR', join(homedir(), '.claude', 'projects'), join(frozenHome, '.claude', 'projects')]);
try {
  const snapshot = await createCompiler(
    { home: frozenHome, importsDir: join(frozenHome, 'imports'), memoPath: join(frozenHome, 'memo.json') },
    [claudeCodeSource],
  ).compile();
  const claudeTool = TOOLS.indexOf('claude-code');
  let requests = 0;
  let costUsd = 0;
  for (let row = 0; row < snapshot.requests.atSec.length; row++) {
    if (snapshot.sessions.tool[snapshot.requests.session[row]] !== claudeTool) continue;
    requests++;
    const resolution = resolvePrice(snapshot.models[snapshot.requests.model[row]]);
    if (resolution.kind !== 'priced') continue;
    const vector = Object.fromEntries(TOKEN_KINDS.map((kind) => [kind, snapshot.requests.tokens[kind][row]])) as Record<TokenKind, number>;
    costUsd += priceRow(resolution.entry, SPEEDS[snapshot.requests.speed[row]], vector);
  }
  const python = JSON.parse(execFileSync('python3', [join(import.meta.dirname, 'claude_gate.py'), frozenHome], { encoding: 'utf8' }));
  const ours = { requests, costUsd: Math.round(costUsd * 100) / 100 };
  console.log(JSON.stringify({ python, snapshot: ours }));
  const pass = python.uniqueMessageIds === ours.requests && python.costUsd === ours.costUsd;
  console.log(pass ? 'GATE PASS' : 'GATE FAIL');
  process.exitCode = pass ? 0 : 1;
} finally {
  await rm(frozenHome, { recursive: true, force: true });
}
