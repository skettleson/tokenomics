#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

type Run = {
  runId: string;
  repo: string;
  gitRev: string;
  port: number;
  url: string;
  serverPid: number;
  home: string;
  snapshotPath: string;
  runDir: string;
  evidenceDir: string;
  chromePids: number[];
  startedAt: string;
};

const REPO = resolve(import.meta.dirname, '..', '..', '..', '..');
const VERIFY_ROOT = join(REPO, '.verify');
const RUNS_DIR = join(VERIFY_ROOT, 'runs');
const EVIDENCE_ROOT = join(VERIFY_ROOT, 'evidence');
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const REAL_HOME = homedir();
const LINKED_SOURCES = ['.claude', '.codex', join('Library', 'Application Support', 'Cursor'), join('.tokenomics', 'imports')];

function fail(message: string): never {
  console.error(`control-tokenomics: ${message}`);
  process.exit(1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function git(...args: string[]): string {
  return spawnSync('git', ['-C', REPO, ...args], { encoding: 'utf8' }).stdout.trim();
}

const SERVER_CODE = ['bin', 'compile', 'shared', 'server.ts', 'package.json'];

function serverBuild(): string {
  const head = git('rev-parse', '--short', 'HEAD');
  const diff = spawnSync('git', ['-C', REPO, 'diff', 'HEAD', '--', ...SERVER_CODE], { encoding: 'utf8' }).stdout;
  return diff ? `${head}+${createHash('sha1').update(diff).digest('hex').slice(0, 8)}` : head;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function runFile(runId: string): string {
  return join(RUNS_DIR, runId, 'run.json');
}

function saveRun(run: Run): void {
  writeFileSync(runFile(run.runId), `${JSON.stringify(run, null, 2)}\n`);
}

function listRuns(): Run[] {
  if (!existsSync(RUNS_DIR)) return [];
  return readdirSync(RUNS_DIR)
    .filter((id) => existsSync(runFile(id)))
    .map((id) => JSON.parse(readFileSync(runFile(id), 'utf8')) as Run);
}

function takeFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const [, value] = args.splice(index, 2);
  return value;
}

function currentRun(args: string[]): Run {
  const requested = takeFlag(args, '--run') ?? process.env.TOKENOMICS_VERIFY_RUN;
  if (requested) {
    if (!existsSync(runFile(requested))) fail(`no run ${requested} under ${RUNS_DIR}`);
    return JSON.parse(readFileSync(runFile(requested), 'utf8')) as Run;
  }
  const live = listRuns().filter((run) => isAlive(run.serverPid));
  if (live.length === 1) return live[0];
  if (live.length === 0) fail('no live verification run; start one with `control-tokenomics launch`');
  fail(`several live runs (${live.map((run) => run.runId).join(', ')}); pass --run <id> or set TOKENOMICS_VERIFY_RUN`);
}

function freePort(): Promise<number> {
  return new Promise((done, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => done(port));
    });
  });
}

function scratchHome(home: string): string[] {
  const linked: string[] = [];
  mkdirSync(join(home, '.tokenomics'), { recursive: true });
  for (const relative of LINKED_SOURCES) {
    const real = join(REAL_HOME, relative);
    if (!existsSync(real)) continue;
    mkdirSync(dirname(join(home, relative)), { recursive: true });
    symlinkSync(real, join(home, relative));
    linked.push(relative);
  }
  return linked;
}

async function waitForLog(path: string, pattern: RegExp, pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pattern.test(readFileSync(path, 'utf8'))) return true;
    if (!isAlive(pid)) return false;
    await sleep(250);
  }
  return false;
}

async function launch(args: string[]): Promise<void> {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  const runId = takeFlag(args, '--id') ?? `${stamp}-${Math.random().toString(36).slice(2, 6)}`;
  const runDir = join(RUNS_DIR, runId);
  if (existsSync(runDir)) fail(`run ${runId} already exists`);
  const home = join(runDir, 'home');
  mkdirSync(home, { recursive: true });
  const linked = scratchHome(home);
  const port = Number(takeFlag(args, '--port') ?? (await freePort()));
  const snapshotPath = join(home, '.tokenomics', 'snapshot.json');
  const logPath = join(runDir, 'server.log');
  const log = openSync(logPath, 'a');
  const server = spawn(process.execPath, [join(REPO, 'bin', 'tokenomics.ts'), 'serve', '--port', String(port), '--out', snapshotPath], {
    cwd: REPO,
    env: { ...process.env, HOME: home },
    detached: true,
    stdio: ['ignore', log, log],
  });
  server.unref();
  const evidenceDir = join(EVIDENCE_ROOT, runId);
  mkdirSync(evidenceDir, { recursive: true });
  const run: Run = {
    runId,
    repo: REPO,
    gitRev: serverBuild(),
    port,
    url: `http://127.0.0.1:${port}/`,
    serverPid: server.pid!,
    home,
    snapshotPath,
    runDir,
    evidenceDir,
    chromePids: [],
    startedAt: new Date().toISOString(),
  };
  saveRun(run);
  console.log(`run ${runId}: server pid ${run.serverPid} on port ${port}, HOME=${home} (linked: ${linked.join(', ') || 'nothing'})`);
  const serving = await waitForLog(logPath, new RegExp(`tokenomics serving http://localhost:${port}`), run.serverPid, 300_000);
  if (!serving) fail(`server never reported serving; see ${logPath}:\n${readFileSync(logPath, 'utf8')}`);
  const settled = await waitForLog(logPath, /snapshot refreshed|background rebuild failed/, run.serverPid, 300_000);
  const tail = readFileSync(logPath, 'utf8').trim();
  if (!settled) fail(`background rebuild did not settle; see ${logPath}`);
  if (/background rebuild failed/.test(tail)) fail(`background rebuild failed:\n${tail}`);
  console.log(tail);
  console.log(`ready: ${run.url}`);
  console.log(`evidence: ${evidenceDir}`);
  console.log(`export TOKENOMICS_VERIFY_RUN=${runId}`);
}

async function doctor(args: string[]): Promise<void> {
  const run = currentRun(args);
  const checks: [string, boolean, string][] = [];
  checks.push(['server process alive', isAlive(run.serverPid), `pid ${run.serverPid}`]);
  const owner = spawnSync('lsof', ['-nP', `-iTCP:${run.port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean).map(Number);
  checks.push(['port owned by this run', owner.includes(run.serverPid), `port ${run.port} listeners: ${owner.join(',') || 'none'}`]);
  checks.push(['HOME is scratch', run.home.startsWith(RUNS_DIR) && existsSync(join(run.home, '.tokenomics')), run.home]);
  const page = await fetch(run.url).then(async (response) => ({ status: response.status, body: await response.text() }), (error) => ({ status: 0, body: String(error) }));
  checks.push(['GET / serves the dashboard', page.status === 200 && page.body.includes('<title>Tokenomics</title>'), `status ${page.status}`]);
  const snapshot = await fetch(new URL('snapshot.json', run.url)).then(
    async (response) => (response.ok ? ((await response.json()) as { builtAt?: string; requests?: { atSec?: unknown[] }; sources?: { source: string; status: string }[] }) : null),
    () => null,
  );
  const sources = snapshot?.sources?.map((source) => `${source.source}:${source.status}`).join(' ') ?? '';
  checks.push(['snapshot parses', Boolean(snapshot?.builtAt), snapshot ? `builtAt ${snapshot.builtAt}, ${snapshot.requests?.atSec?.length ?? 0} requests, ${sources}` : 'unreadable']);
  const rev = serverBuild();
  checks.push(['build matches checkout', rev === run.gitRev, `launched at ${run.gitRev}, checkout now ${rev} (web/ reloads per request; server.ts, compile/, bin/ need relaunch)`]);
  for (const [name, ok, detail] of checks) console.log(`${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(28)} ${detail}`);
  console.log(`run ${run.runId} ${run.url} evidence ${run.evidenceDir}`);
  process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1;
}

function env(args: string[]): void {
  const run = currentRun(args);
  console.log(`export TOKENOMICS_VERIFY_RUN=${run.runId}`);
  console.log(`export TOKENOMICS_URL=${run.url}`);
  console.log(`export TOKENOMICS_HOME=${run.home}`);
  console.log(`export TOKENOMICS_SNAPSHOT=${run.snapshotPath}`);
  console.log(`export TOKENOMICS_EVIDENCE=${run.evidenceDir}`);
}

function cli(args: string[]): void {
  const run = currentRun(args);
  const label = takeFlag(args, '--label') ?? 'cli';
  const separator = args.indexOf('--');
  const command = separator >= 0 ? args.slice(separator + 1) : args;
  const result = spawnSync(process.execPath, [join(REPO, 'bin', 'tokenomics.ts'), ...command], { cwd: REPO, env: { ...process.env, HOME: run.home }, encoding: 'utf8', timeout: 600_000 });
  const dir = join(run.evidenceDir, label);
  mkdirSync(dir, { recursive: true });
  const record = `$ HOME=${run.home} node bin/tokenomics.ts ${command.join(' ')}\n--- exit ${result.status}\n--- stdout\n${result.stdout}\n--- stderr\n${result.stderr}`;
  const path = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
  writeFileSync(path, record);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  console.log(`exit ${result.status}; transcript ${path}`);
  process.exitCode = result.status ?? 1;
}

type Cdp = { send(method: string, params?: Record<string, unknown>): Promise<any>; close(): void };

async function connect(wsUrl: string): Promise<Cdp> {
  const socket = new WebSocket(wsUrl);
  await new Promise((done, reject) => {
    socket.addEventListener('open', done, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map<number, { done: (value: any) => void; reject: (error: Error) => void }>();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    const waiter = message.id === undefined ? undefined : pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(`${message.error.message}`));
    else waiter.done(message.result);
  });
  return {
    send(method, params = {}) {
      const id = ++nextId;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((done, reject) => pending.set(id, { done, reject }));
    },
    close() {
      socket.close();
    },
  };
}

async function startChrome(run: Run): Promise<{ chrome: ChildProcess; cdp: Cdp }> {
  if (!existsSync(CHROME)) fail(`Chrome not found at ${CHROME}; set CHROME_PATH`);
  const profile = join(run.runDir, `chrome-${Date.now()}`);
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1400,1000', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  run.chromePids.push(chrome.pid!);
  saveRun(run);
  const portFile = join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + 20_000;
  while (!existsSync(portFile) || !readFileSync(portFile, 'utf8').includes('\n')) {
    if (Date.now() > deadline) fail('Chrome never wrote DevToolsActivePort');
    await sleep(100);
  }
  const debugPort = readFileSync(portFile, 'utf8').split('\n')[0];
  let target: { webSocketDebuggerUrl: string } | undefined;
  while (!target) {
    if (Date.now() > deadline) fail('Chrome exposed no page target');
    const targets = (await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json(), () => [])) as { type: string; webSocketDebuggerUrl: string }[];
    target = targets.find((candidate) => candidate.type === 'page');
    if (!target) await sleep(100);
  }
  const cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  return { chrome, cdp };
}

async function evaluate(cdp: Cdp, expression: string): Promise<any> {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(cdp: Cdp, predicate: string, what: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, `Boolean(${predicate})`).catch(() => false)) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const READY = `document.querySelector('#app h1') && !document.body.innerText.includes('Rebuilding…')`;

const STATE = `(() => {
  const text = (element) => element ? element.textContent.trim() : null;
  const all = (selector, root = document) => [...root.querySelectorAll(selector)];
  const failed = document.querySelector('.status-message');
  const findings = document.querySelector('section.findings');
  return {
    url: location.href,
    hash: decodeURIComponent(location.hash),
    status: failed ? failed.innerText : null,
    header: text(document.querySelector('.title-row .muted')),
    dateRange: all('[aria-label="Date range"] .segment[aria-pressed="true"]').map(text),
    stackBy: all('.segmented:not([aria-label]) .segment[aria-pressed="true"]').map(text),
    chips: all('.chips .chip').map((chip) => chip.getAttribute('aria-label')),
    kpis: all('#chart-kpis .stat-tile').map((tile) => ({ label: text(tile.querySelector('.stat-label')), value: text(tile.querySelector('.stat-value')), note: text(tile.querySelector('.stat-note')) })),
    recommendations: findings ? text(findings.querySelector('.card-subtitle')) : null,
    findingCards: findings ? all('.finding', findings).map((card) => [text(card.querySelector('.severity-badge')), text(card.querySelector('.finding-title')), text(card.querySelector('.finding-count')) || text(card.querySelector('.finding-subject'))].filter(Boolean).join(' | ')) : [],
    pressedBars: all('g.bar-row[aria-pressed="true"] .row-label').map(text),
    selectedSessions: all('.sessions-table tr.is-selected td.title-cell').map(text),
    tablesShown: all('.link-button[aria-pressed="true"]').map((toggle) => toggle.closest('section')?.id),
    sources: all('#chart-sources tbody tr').map((row) => all('td', row).map(text).slice(0, 3).join(' | ')),
    snapshotBuilt: text(document.querySelector('.sources-footer .muted')),
  };
})()`;

function locator(step: string): string {
  return `(() => {
    const step = ${JSON.stringify(step)};
    const slash = step.indexOf('/');
    const prefix = slash > 0 ? step.slice(0, slash) : null;
    const card = prefix && document.getElementById('chart-' + prefix);
    const finding = prefix && !card ? [...document.querySelectorAll('section.findings .finding')].find((item) => item.querySelector('.finding-title')?.textContent.trim() === prefix) : null;
    const scope = card || finding || document;
    const wanted = card || finding ? step.slice(slash + 1) : step;
    const nameOf = (element) => {
      const label = element.getAttribute('aria-label');
      const svgLabel = element.querySelector && element.querySelector('.row-label');
      return [label, svgLabel && svgLabel.textContent.trim(), element.textContent.trim()].filter(Boolean);
    };
    const matches = (candidate) => candidate === wanted || candidate.replace(/\\s+×$/, '') === wanted || (candidate.endsWith('…') && wanted.startsWith(candidate.slice(0, -1)));
    const found = [...scope.querySelectorAll('button, [role="button"]')].filter((element) => nameOf(element).some(matches));
    return { count: found.length, index: found.length ? [...document.querySelectorAll('*')].indexOf(found[0]) : -1 };
  })()`;
}

async function clickAt(cdp: Cdp, x: number, y: number): Promise<void> {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

async function centerOf(cdp: Cdp, elementExpression: string): Promise<{ x: number; y: number; width: number; height: number; left: number; top: number }> {
  const box = await evaluate(cdp, `(() => { const element = ${elementExpression}; if (!element) return null; element.scrollIntoView({ block: 'center', inline: 'nearest' }); const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height, left: rect.left, top: rect.top }; })()`);
  if (!box) throw new Error('target element not found');
  return box;
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48).toLowerCase() || 'step';
}

async function browser(args: string[]): Promise<void> {
  const run = currentRun(args);
  const label = takeFlag(args, '--label') ?? 'browser';
  const steps = args;
  if (steps.length === 0) fail('browser needs steps, e.g. `browser --label demo open state:initial shot:initial`');
  const dir = join(run.evidenceDir, label);
  mkdirSync(dir, { recursive: true });
  const transcript = join(dir, 'transcript.log');
  let counter = readdirSync(dir).filter((name) => /^\d{2}-.*\.state\.json$/.test(name)).length;
  const record = (line: string) => {
    appendFileSync(transcript, `${new Date().toISOString()} ${line}\n`);
    console.log(line);
  };
  const capture = async (name: string) => {
    counter += 1;
    const base = join(dir, `${String(counter).padStart(2, '0')}-${slug(name)}`);
    const state = await evaluate(cdp, STATE);
    writeFileSync(`${base}.state.json`, `${JSON.stringify(state, null, 2)}\n`);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(`${base}.png`, Buffer.from(shot.data, 'base64'));
    record(`  captured ${base}.png + .state.json  hash=${JSON.stringify(state.hash)} chips=${JSON.stringify(state.chips)}`);
    return state;
  };
  const { chrome, cdp } = await startChrome(run);
  let exitCode = 0;
  try {
    record(`== run ${run.runId} label ${label} url ${run.url}`);
    for (const step of steps) {
      const colon = step.indexOf(':');
      const verb = colon < 0 ? step : step.slice(0, colon);
      const argument = colon < 0 ? '' : step.slice(colon + 1);
      record(`> ${step}`);
      switch (verb) {
        case 'open': {
          await cdp.send('Page.navigate', { url: `${run.url}${argument}` });
          await waitFor(cdp, READY, 'dashboard render', 120_000);
          await sleep(300);
          break;
        }
        case 'click': {
          const found = await evaluate(cdp, locator(argument));
          if (found.error || found.count === 0) throw new Error(`no button or [role=button] named ${JSON.stringify(argument)}${found.error ? ` (${found.error})` : ''}`);
          if (found.count > 1) record(`  ${found.count} matches; clicking the first in document order`);
          const box = await centerOf(cdp, `document.querySelectorAll('*')[${found.index}]`);
          await clickAt(cdp, box.x, box.y);
          await sleep(400);
          await waitFor(cdp, READY, 'dashboard settle', 120_000);
          await capture(`click-${argument}`);
          break;
        }
        case 'row': {
          const slash = argument.indexOf('/');
          const card = argument.slice(0, slash);
          const wanted = argument.slice(slash + 1);
          const rowExpression = wanted.startsWith('#')
            ? `document.querySelectorAll(${JSON.stringify(`#chart-${card} tbody tr`)})[${Number(wanted.slice(1)) - 1}]`
            : `[...document.querySelectorAll(${JSON.stringify(`#chart-${card} tbody tr`)})].find((row) => row.cells[0] && row.cells[0].textContent.trim() === ${JSON.stringify(wanted)})`;
          const box = await centerOf(cdp, rowExpression);
          await clickAt(cdp, box.x, box.y);
          await sleep(400);
          await capture(`row-${argument}`);
          break;
        }
        case 'drag':
        case 'point': {
          const slash = argument.indexOf('/');
          const card = argument.slice(0, slash);
          const box = await centerOf(cdp, `document.querySelector(${JSON.stringify(`#chart-${card} .hit-layer`)})`);
          if (verb === 'point') {
            const [fx, fy] = argument.slice(slash + 1).split(',').map(Number);
            await clickAt(cdp, box.left + box.width * fx, box.top + box.height * fy);
          } else {
            const [from, to] = argument.slice(slash + 1).split('-').map(Number);
            const y = box.top + box.height * 0.5;
            const start = box.left + box.width * from;
            const end = box.left + box.width * to;
            await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start, y });
            await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start, y, button: 'left', buttons: 1, clickCount: 1 });
            for (let i = 1; i <= 8; i += 1) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start + ((end - start) * i) / 8, y, button: 'left', buttons: 1 });
            await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end, y, button: 'left', buttons: 0, clickCount: 1 });
          }
          await sleep(400);
          await capture(`${verb}-${argument}`);
          break;
        }
        case 'wait-text':
          await waitFor(cdp, `document.body.innerText.includes(${JSON.stringify(argument)})`, `text ${JSON.stringify(argument)}`, 300_000);
          break;
        case 'wait-gone':
          await waitFor(cdp, `!document.body.innerText.includes(${JSON.stringify(argument)})`, `text ${JSON.stringify(argument)} to disappear`, 300_000);
          break;
        case 'state':
        case 'shot':
          await capture(argument || verb);
          break;
        case 'eval': {
          const value = await evaluate(cdp, argument);
          record(`  = ${JSON.stringify(value)}`);
          break;
        }
        default:
          throw new Error(`unknown step ${JSON.stringify(step)}`);
      }
    }
  } catch (error) {
    exitCode = 1;
    record(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
    await capture('failure').catch(() => {});
  } finally {
    cdp.close();
    chrome.kill('SIGTERM');
    await sleep(300);
    if (chrome.pid && isAlive(chrome.pid)) chrome.kill('SIGKILL');
    run.chromePids = run.chromePids.filter((pid) => pid !== chrome.pid);
    saveRun(run);
  }
  record(`evidence: ${dir}`);
  process.exitCode = exitCode;
}

async function stopPid(pid: number, what: string): Promise<void> {
  if (!isAlive(pid)) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    process.kill(pid, 'SIGTERM');
  }
  for (let i = 0; i < 20 && isAlive(pid); i += 1) await sleep(100);
  if (isAlive(pid)) process.kill(pid, 'SIGKILL');
  console.log(`stopped ${what} pid ${pid}`);
}

async function cleanup(args: string[]): Promise<void> {
  const everything = args.includes('--all');
  const runs = everything ? listRuns() : [currentRun(args.filter((arg) => arg !== '--all'))];
  for (const run of runs) {
    for (const pid of run.chromePids) await stopPid(pid, 'chrome');
    await stopPid(run.serverPid, 'server');
    rmSync(run.runDir, { recursive: true, force: true });
    const kept = existsSync(run.evidenceDir) ? readdirSync(run.evidenceDir, { recursive: true }).filter((name) => statSync(join(run.evidenceDir, String(name))).isFile()).length : 0;
    console.log(`removed ${run.runDir}; kept ${kept} evidence files in ${run.evidenceDir}`);
  }
  if (runs.length === 0) console.log('no runs to clean up');
}

const USAGE = `usage: control-tokenomics <command>
  launch [--port N] [--id ID]      start an isolated server (scratch HOME, free port) and wait until ready
  doctor [--run ID]                read-only health check of a run
  env [--run ID]                   print shell exports for the run (URL, HOME, snapshot, evidence dir)
  browser [--run ID] [--label L] <step>...
      open[:#hash]  click:[card/]name  row:card/<first cell>|#n  drag:card/0.6-0.9  point:card/x,y
      wait-text:T  wait-gone:T  state:name  shot:name  eval:js
  cli [--run ID] [--label L] -- <tokenomics args>   run bin/tokenomics.ts against the run's HOME
  cleanup [--run ID | --all]       stop what the run started, delete scratch state, keep evidence`;

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case 'launch':
    await launch(rest);
    break;
  case 'doctor':
    await doctor(rest);
    break;
  case 'env':
    env(rest);
    break;
  case 'browser':
    await browser(rest);
    break;
  case 'cli':
    cli(rest);
    break;
  case 'cleanup':
    await cleanup(rest);
    break;
  default:
    console.log(USAGE);
    process.exitCode = command ? 2 : 0;
}
