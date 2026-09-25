import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createCompiler, defaultEnv, writeSnapshotAtomically } from '../compile/compile.ts';
import { parseSnapshot } from '../shared/snapshot.ts';
import { loadCube } from '../web/cube.ts';
import { evaluateRules, ruleDistributions, THRESHOLDS } from '../web/rules.ts';
import { createRebuilder, startServer } from '../server.ts';

export type Command =
  | { kind: 'serve'; port: number; snapshotPath: string }
  | { kind: 'build'; out: string }
  | { kind: 'calibrate'; snapshotPath: string }
  | { kind: 'usage'; message: string };

const USAGE = 'usage: tokenomics serve [--port 4317] | build [--out file] | calibrate [--snapshot file]';

export function parseArgs(argv: readonly string[], home: string): Command {
  const [command, ...rest] = argv;
  const flag = (name: string): string | undefined => {
    const index = rest.indexOf(name);
    return index >= 0 ? rest[index + 1] : undefined;
  };
  const snapshotPath = flag('--out') ?? join(home, '.tokenomics', 'snapshot.json');
  if (command === 'serve') {
    const port = Number(flag('--port') ?? 4317);
    if (!Number.isInteger(port) || port <= 0) return { kind: 'usage', message: `invalid port\n${USAGE}` };
    return { kind: 'serve', port, snapshotPath };
  }
  if (command === 'build') return { kind: 'build', out: snapshotPath };
  if (command === 'calibrate') return { kind: 'calibrate', snapshotPath: flag('--snapshot') ?? snapshotPath };
  return { kind: 'usage', message: USAGE };
}

export async function main(argv: readonly string[]): Promise<number> {
  const home = homedir();
  const command = parseArgs(argv, home);
  if (command.kind === 'usage') {
    console.error(command.message);
    return 2;
  }
  if (command.kind === 'calibrate') return calibrate(command.snapshotPath);
  if (command.kind === 'serve') return serve(command.port, command.snapshotPath, home);
  const started = Date.now();
  const snapshot = await createCompiler(defaultEnv(home)).compile();
  await writeSnapshotAtomically(command.out, snapshot);
  console.log(`wrote ${command.out}: ${snapshot.requests.atSec.length} requests, ${snapshot.sessions.id.length} sessions in ${Date.now() - started} ms`);
  return 0;
}

async function serve(port: number, snapshotPath: string, home: string): Promise<number> {
  const rebuilder = createRebuilder(createCompiler(defaultEnv(home)), snapshotPath);
  await rebuilder.ready();
  await startServer({ port, host: '127.0.0.1', appRoot: dirname(import.meta.dirname), snapshotPath, rebuilder });
  console.log(`tokenomics serving http://localhost:${port}`);
  rebuilder.rebuild().then(
    ({ builtAt }) => console.log(`snapshot refreshed ${builtAt}`),
    (error) => console.error(`background rebuild failed: ${String(error)}`),
  );
  return new Promise<number>(() => {});
}

async function calibrate(snapshotPath: string): Promise<number> {
  const parsed = parseSnapshot(JSON.parse(await readFile(snapshotPath, 'utf8')));
  if (!parsed.ok) {
    console.error(parsed.reason);
    return 1;
  }
  const cube = loadCube(parsed.snapshot, { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  const round = (value: number) => Number(value.toPrecision(4));
  console.table(ruleDistributions(cube).map((row) => ({ ...row, p50: round(row.p50), p90: round(row.p90), p99: round(row.p99), max: round(row.max) })));
  console.log('THRESHOLDS', JSON.stringify(THRESHOLDS));
  const findings = evaluateRules({ cube, selection: cube.select({}), now: new Date() });
  console.log(`${findings.length} findings`);
  for (const finding of findings) {
    console.log(`${finding.rule.padEnd(22)} ${finding.metric.value.toPrecision(4).padStart(12)} ${finding.metric.comparator} ${String(finding.metric.threshold).padEnd(8)} ${finding.basis.padEnd(9)} ${finding.subject}`);
  }
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
