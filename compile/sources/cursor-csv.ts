import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tokens } from '../../shared/snapshot.ts';
import { fileStamp } from '../source.ts';
import type { Discovery, Env, FilePart, SessionPart, Source, UsageFact } from '../source.ts';

export type UsageExportRow = {
  line: string;
  atMs: number;
  model: string;
  inputWithCacheWrite: number;
  inputWithoutCacheWrite: number;
  cacheRead: number;
  output: number;
  total: number;
  costUsd: number | null;
};

export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}

function count(value: string | undefined): number {
  const parsed = Number((value ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function money(value: string | undefined): number | null {
  const cleaned = (value ?? '').replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

const COLUMN_NAMES = {
  date: 'date',
  model: 'model',
  inputWithCacheWrite: 'input (w/ cache write)',
  inputWithoutCacheWrite: 'input (w/o cache write)',
  cacheRead: 'cache read',
  output: 'output tokens',
  total: 'total tokens',
  cost: 'cost',
} as const;

export function parseUsageExportCsv(text: string): UsageExportRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]).map((name) => name.toLowerCase());
  const column = Object.fromEntries(
    Object.entries(COLUMN_NAMES).map(([field, name]) => [field, header.indexOf(name)]),
  ) as Record<keyof typeof COLUMN_NAMES, number>;
  if (column.date < 0 || column.model < 0) throw new Error('usage CSV needs Date and Model columns');
  const rows: UsageExportRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const atMs = Date.parse(cells[column.date] ?? '');
    if (Number.isNaN(atMs)) continue;
    rows.push({
      line,
      atMs,
      model: cells[column.model] || 'cursor-unknown',
      inputWithCacheWrite: count(cells[column.inputWithCacheWrite]),
      inputWithoutCacheWrite: count(cells[column.inputWithoutCacheWrite]),
      cacheRead: count(cells[column.cacheRead]),
      output: count(cells[column.output]),
      total: count(cells[column.total]),
      costUsd: column.cost < 0 ? null : money(cells[column.cost]),
    });
  }
  return rows;
}

function exportRowTokens(row: UsageExportRow) {
  const disjointSum = row.inputWithCacheWrite + row.inputWithoutCacheWrite + row.cacheRead + row.output;
  const cacheWriteIncludesPlainInput = row.total > 0 && disjointSum - row.total === row.inputWithoutCacheWrite && row.inputWithoutCacheWrite > 0;
  const cacheWrite = cacheWriteIncludesPlainInput ? row.inputWithCacheWrite - row.inputWithoutCacheWrite : row.inputWithCacheWrite;
  return tokens({ input: row.inputWithoutCacheWrite, cacheWrite5m: cacheWrite, cacheRead: row.cacheRead, output: row.output });
}

export function measuredUsageFromExport(rows: readonly UsageExportRow[]): FilePart {
  const sessions = new Map<string, SessionPart>();
  const occurrences = new Map<string, number>();
  const usage: UsageFact[] = [];
  for (const row of rows) {
    const day = new Date(row.atMs).toISOString().slice(0, 10);
    const sessionKey = `cursor-csv:${day}`;
    if (!sessions.has(sessionKey)) {
      sessions.set(sessionKey, {
        key: sessionKey,
        tool: 'cursor',
        kind: 'billingDay',
        projectPath: null,
        title: `Cursor billing day ${day}`,
        titleRank: 1,
        humanTurnIds: [],
      });
    }
    const occurrence = (occurrences.get(row.line) ?? 0) + 1;
    occurrences.set(row.line, occurrence);
    const digest = createHash('sha1').update(row.line).digest('hex').slice(0, 16);
    usage.push({
      key: `cursor-csv:${digest}:${occurrence}`,
      sessionKey,
      atMs: row.atMs,
      model: row.model,
      speed: 'standard',
      agent: 'main',
      fidelity: 'measured',
      tokens: exportRowTokens(row),
      reportedCostUsd: row.costUsd,
    });
  }
  return { sessions: [...sessions.values()], usage };
}

async function discover(env: Env): Promise<Discovery> {
  const directory = join(env.importsDir, 'cursor');
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return { kind: 'missing', lookedAt: directory };
  }
  const paths = names.filter((name) => name.toLowerCase().endsWith('.csv')).map((name) => join(directory, name)).sort();
  if (paths.length === 0) return { kind: 'missing', lookedAt: directory };
  return { kind: 'found', files: await Promise.all(paths.map(async (path) => ({ path, stamp: await fileStamp(path) }))) };
}

export const cursorCsvSource: Source = {
  id: 'cursor-csv',
  tool: 'cursor',
  parserVersion: 1,
  discover,
  async parseFile(path) {
    return measuredUsageFromExport(parseUsageExportCsv(await readFile(path, 'utf8')));
  },
};
