import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { AGENTS, FIDELITIES, SESSION_KINDS, SPEEDS, TOKEN_KINDS, TOOLS } from '../shared/snapshot.ts';
import type { Fidelity, SnapshotV1, SourceId, SourceReport, Tool, TokenKind } from '../shared/snapshot.ts';
import type { Discovery, Env, FilePart, SessionFact, SessionPart, Source, UsageFact } from './source.ts';
import { claudeCodeSource } from './sources/claude.ts';
import { codexSource } from './sources/codex.ts';
import { cursorSource } from './sources/cursor.ts';
import { cursorCsvSource } from './sources/cursor-csv.ts';

export type { Discovery, Env, FilePart, SessionFact, SessionPart, Source, UsageFact };

export function defaultEnv(home: string): Env {
  return {
    home,
    importsDir: join(home, '.tokenomics', 'imports'),
    memoPath: join(home, '.tokenomics', 'memo.json'),
  };
}

export type Harvest = {
  source: SourceId;
  sessions: SessionFact[];
  usage: UsageFact[];
  report: SourceReport;
};

type MemoEntry = { stamp: string; parserVersion: number; part: FilePart };
type Memo = { version: 1; sources: Partial<Record<SourceId, Record<string, MemoEntry>>> };

export type Compiler = {
  compile(): Promise<SnapshotV1>;
};

export const SOURCES: readonly Source[] = [claudeCodeSource, codexSource, cursorSource, cursorCsvSource];

export function createCompiler(env: Env, sources: readonly Source[] = SOURCES): Compiler {
  return {
    async compile() {
      const memo = await readMemo(env.memoPath);
      const harvests: Harvest[] = [];
      for (const source of sources) {
        const previous = memo.sources[source.id] ?? {};
        const { harvest, entries } = await harvestSource(source, env, previous);
        memo.sources[source.id] = entries;
        harvests.push(harvest);
      }
      await writeJsonAtomically(env.memoPath, memo);
      return encodeSnapshot(supersedeEstimatesByMeasuredDays(harvests), new Date(), env.home);
    },
  };
}

async function readMemo(path: string): Promise<Memo> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    if (parsed && parsed.version === 1 && typeof parsed.sources === 'object') return parsed as Memo;
  } catch {}
  return { version: 1, sources: {} };
}

async function mapLimited<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function harvestSource(
  source: Source,
  env: Env,
  previous: Record<string, MemoEntry>,
): Promise<{ harvest: Harvest; entries: Record<string, MemoEntry> }> {
  const entries: Record<string, MemoEntry> = {};
  let discovery: Discovery;
  try {
    discovery = await source.discover(env);
  } catch (error) {
    const merged = mergeParts(source.tool, Object.values(previous).map((entry) => entry.part), new Map());
    return {
      harvest: { source: source.id, ...merged, report: { source: source.id, tool: source.tool, status: 'failed', error: String(error) } },
      entries: previous,
    };
  }
  const found = discovery.kind === 'found' ? discovery.files : [];
  const foundPaths = new Set(found.map((file) => file.path));
  let filesParsed = 0;
  const notes: string[] = [];
  const liveParts = await mapLimited(found, 8, async (file) => {
    const cached = previous[file.path];
    if (cached && cached.stamp === file.stamp && cached.parserVersion === source.parserVersion) {
      entries[file.path] = cached;
      return cached.part;
    }
    try {
      const part = await source.parseFile(file.path);
      filesParsed++;
      entries[file.path] = { stamp: file.stamp, parserVersion: source.parserVersion, part };
      return part;
    } catch (error) {
      notes.push(`could not read ${file.path}: ${String(error)}`);
      if (cached) entries[file.path] = cached;
      return cached ? cached.part : { sessions: [], usage: [] };
    }
  });
  const retainedParts: FilePart[] = [];
  for (const [path, entry] of Object.entries(previous)) {
    if (foundPaths.has(path)) continue;
    entries[path] = entry;
    retainedParts.push(entry.part);
  }
  const titles = source.sessionTitles ? await source.sessionTitles(env).catch(() => new Map<string, string>()) : new Map<string, string>();
  const merged = mergeParts(source.tool, [...liveParts, ...retainedParts], titles);
  const liveKeys = new Set<string>();
  for (const part of liveParts) for (const fact of part.usage) liveKeys.add(fact.key);
  const retainedRequests = merged.usage.filter((fact) => !liveKeys.has(fact.key)).length;
  const report: SourceReport =
    discovery.kind === 'missing'
      ? {
          source: source.id,
          tool: source.tool,
          status: 'missing',
          lookedAt: discovery.lookedAt,
          filesRetained: retainedParts.length,
          retainedRequests,
        }
      : {
          source: source.id,
          tool: source.tool,
          status: 'ok',
          filesSeen: found.length,
          filesParsed,
          filesRetained: retainedParts.length,
          sessions: merged.sessions.length,
          requests: merged.usage.length,
          retainedRequests,
          fidelity: fidelityCounts(merged.usage),
          notes,
        };
  return { harvest: { source: source.id, ...merged, report }, entries };
}

export function mergeParts(
  tool: Tool,
  parts: readonly FilePart[],
  titles: ReadonlyMap<string, string>,
): { sessions: SessionFact[]; usage: UsageFact[] } {
  const usageByKey = new Map<string, UsageFact>();
  for (const part of parts) {
    for (const fact of part.usage) {
      const existing = usageByKey.get(fact.key);
      usageByKey.set(fact.key, existing ? mergeDuplicateUsage(existing, fact) : fact);
    }
  }
  const sessionsByKey = new Map<string, { part: SessionPart; turns: Set<string> }>();
  for (const part of parts) {
    for (const session of part.sessions) {
      const existing = sessionsByKey.get(session.key);
      if (!existing) {
        sessionsByKey.set(session.key, { part: { ...session }, turns: new Set(session.humanTurnIds) });
        continue;
      }
      for (const id of session.humanTurnIds) existing.turns.add(id);
      existing.part.projectPath ??= session.projectPath;
      if (session.title && session.titleRank >= existing.part.titleRank) {
        existing.part.title = session.title;
        existing.part.titleRank = session.titleRank;
      }
    }
  }
  const usage = [...usageByKey.values()];
  const usedSessions = new Set(usage.map((fact) => fact.sessionKey));
  const sessions: SessionFact[] = [];
  for (const { part, turns } of sessionsByKey.values()) {
    if (!usedSessions.has(part.key)) continue;
    sessions.push({
      key: part.key,
      tool,
      kind: part.kind,
      projectPath: part.projectPath,
      title: titles.get(part.key) ?? part.title,
      humanTurns: turns.size,
    });
  }
  return { sessions, usage };
}

function mergeDuplicateUsage(a: UsageFact, b: UsageFact): UsageFact {
  const first = a.atMs < b.atMs || (a.atMs === b.atMs && a.sessionKey <= b.sessionKey) ? a : b;
  const merged = {} as Record<TokenKind, number>;
  for (const kind of TOKEN_KINDS) merged[kind] = Math.max(a.tokens[kind], b.tokens[kind]);
  return { ...first, tokens: merged };
}

function fidelityCounts(usage: readonly UsageFact[]): Record<Fidelity, number> {
  const counts = Object.fromEntries(FIDELITIES.map((fidelity) => [fidelity, 0])) as Record<Fidelity, number>;
  for (const fact of usage) counts[fact.fidelity]++;
  return counts;
}

function utcDay(atMs: number): string {
  return new Date(atMs).toISOString().slice(0, 10);
}

export function supersedeEstimatesByMeasuredDays(harvests: readonly Harvest[]): Harvest[] {
  const measuredDays = new Set<string>();
  for (const harvest of harvests) {
    if (harvest.source !== 'cursor-csv') continue;
    for (const fact of harvest.usage) measuredDays.add(utcDay(fact.atMs));
  }
  if (measuredDays.size === 0) return [...harvests];
  return harvests.map((harvest) => {
    if (harvest.source !== 'cursor') return harvest;
    const usage = harvest.usage.filter((fact) => fact.fidelity !== 'estimated' || !measuredDays.has(utcDay(fact.atMs)));
    const liveSessions = new Set(usage.map((fact) => fact.sessionKey));
    const superseded = harvest.usage.length - usage.length;
    const report: SourceReport =
      harvest.report.status === 'ok'
        ? {
            ...harvest.report,
            requests: usage.length,
            sessions: liveSessions.size,
            fidelity: fidelityCounts(usage),
            notes: [...harvest.report.notes, `${superseded} estimated requests superseded by imported usage CSV`],
          }
        : harvest.report;
    return { ...harvest, usage, sessions: harvest.sessions.filter((session) => liveSessions.has(session.key)), report };
  });
}

export function normalizeProject(path: string | null, home: string): string {
  if (!path) return '(unknown)';
  let normalized = path.replace(/\/+$/, '');
  const worktree = normalized.indexOf('/.claude/worktrees/');
  if (worktree >= 0) normalized = normalized.slice(0, worktree);
  if (home && (normalized === home || normalized.startsWith(`${home}/`))) normalized = `~${normalized.slice(home.length)}`;
  return normalized || '(unknown)';
}

class Dictionary {
  readonly values: string[] = [];
  private readonly index = new Map<string, number>();
  key(value: string): number {
    let key = this.index.get(value);
    if (key === undefined) {
      key = this.values.length;
      this.values.push(value);
      this.index.set(value, key);
    }
    return key;
  }
}

export function encodeSnapshot(harvests: readonly Harvest[], builtAt: Date, home: string): SnapshotV1 {
  const models = new Dictionary();
  const projects = new Dictionary();
  const sessionIndex = new Map<string, number>();
  const sessions: SnapshotV1['sessions'] = { id: [], tool: [], kind: [], project: [], title: [], humanTurns: [] };
  for (const harvest of harvests) {
    for (const session of harvest.sessions) {
      if (sessionIndex.has(session.key)) continue;
      sessionIndex.set(session.key, sessions.id.length);
      sessions.id.push(session.key);
      sessions.tool.push(TOOLS.indexOf(session.tool));
      sessions.kind.push(SESSION_KINDS.indexOf(session.kind));
      sessions.project.push(projects.key(normalizeProject(session.projectPath, home)));
      sessions.title.push(session.title ?? '');
      sessions.humanTurns.push(session.humanTurns);
    }
  }
  const usage = harvests.flatMap((harvest) => harvest.usage).filter((fact) => sessionIndex.has(fact.sessionKey));
  usage.sort((a, b) => a.atMs - b.atMs || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const tokenColumns = Object.fromEntries(TOKEN_KINDS.map((kind) => [kind, [] as number[]])) as Record<TokenKind, number[]>;
  const requests: SnapshotV1['requests'] = {
    atSec: [],
    session: [],
    model: [],
    speed: [],
    agent: [],
    fidelity: [],
    reportedCostMicroUsd: [],
    tokens: tokenColumns,
  };
  for (const fact of usage) {
    requests.atSec.push(Math.floor(fact.atMs / 1000));
    requests.session.push(sessionIndex.get(fact.sessionKey)!);
    requests.model.push(models.key(fact.model));
    requests.speed.push(SPEEDS.indexOf(fact.speed));
    requests.agent.push(AGENTS.indexOf(fact.agent));
    requests.fidelity.push(FIDELITIES.indexOf(fact.fidelity));
    requests.reportedCostMicroUsd.push(fact.reportedCostUsd === null ? null : Math.round(fact.reportedCostUsd * 1_000_000));
    for (const kind of TOKEN_KINDS) tokenColumns[kind].push(fact.tokens[kind]);
  }
  return {
    version: 1,
    builtAt: builtAt.toISOString(),
    sources: harvests.map((harvest) => harvest.report),
    models: models.values,
    projects: projects.values,
    sessions,
    requests,
  };
}

export async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(value));
  await rename(temporary, path);
}

export function writeSnapshotAtomically(path: string, snapshot: SnapshotV1): Promise<void> {
  return writeJsonAtomically(path, snapshot);
}
