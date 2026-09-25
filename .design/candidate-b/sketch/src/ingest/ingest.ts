import type { Stats } from 'node:fs';
import type { AdapterId, AppendLogCursor, IngestCursor, SourceAdapter } from './adapters.ts';
import type { SourceFileRow, Writer } from '../warehouse/warehouse.ts';
import { claudeCode } from './claude-code.ts';
import { codex } from './codex.ts';
import { cursorDb } from './cursor-db.ts';
import { cursorCsv } from './cursor-csv.ts';

export const ADAPTERS: readonly SourceAdapter[] = [claudeCode, codex, cursorDb, cursorCsv];

export type ReadPlan =
  | { kind: 'skip' }
  | { kind: 'resume'; fromOffset: number; carry: unknown }
  | { kind: 'rebuild' };

export type FileOutcome =
  | { kind: 'skipped' }
  | { kind: 'appended'; inserted: number; duplicates: number }
  | { kind: 'rebuilt'; inserted: number; duplicates: number }
  | { kind: 'failed'; error: string };

export type IngestReport = {
  startedAtMs: number;
  finishedAtMs: number;
  byAdapter: Record<AdapterId, { files: number; skipped: number; inserted: number; duplicates: number; failed: number; missing: number }>;
  failures: { path: string; error: string }[];
};

export type IngestProgress =
  | { kind: 'started'; files: number }
  | { kind: 'file'; adapter: AdapterId; path: string; outcome: FileOutcome }
  | { kind: 'finished'; report: IngestReport };

export async function ingestAll(writer: Writer, onProgress: (p: IngestProgress) => void): Promise<IngestReport> {
  throw new Error('not implemented');
}

export function planAppendLogRead(
  stored: SourceFileRow | null,
  parserVersion: number,
  stat: Pick<Stats, 'size'>,
  headHash: string,
): ReadPlan {
  throw new Error('not implemented');
}

export function planSnapshotRead(stored: SourceFileRow | null, parserVersion: number, fingerprint: string): ReadPlan {
  throw new Error('not implemented');
}

export function splitCompleteLines(chunk: Buffer, startOffset: number): { lines: string[]; endOffset: number } {
  throw new Error('not implemented');
}

function nextAppendCursor(previous: AppendLogCursor | null, sizeBytes: number, headHash: string, endOffset: number, carry: unknown): IngestCursor {
  throw new Error('not implemented');
}
