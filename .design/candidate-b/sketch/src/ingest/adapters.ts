import type { Batch } from '../domain.ts';

export type AdapterId = 'claude_code' | 'codex' | 'cursor_db' | 'cursor_csv';

export type AppendLogCursor = {
  kind: 'append_log';
  sizeBytes: number;
  headHash: string;
  offset: number;
  carry: unknown;
};

export type SnapshotCursor = {
  kind: 'snapshot';
  fingerprint: string;
};

export type IngestCursor = AppendLogCursor | SnapshotCursor;

export type AppendLogSpec<Carry> = {
  id: AdapterId;
  parserVersion: number;
  discover(): string[];
  initialCarry(path: string): Carry;
  parseCarry(stored: unknown): Carry;
  parseLines(lines: readonly string[], carry: Carry): { batch: Batch; carry: Carry };
};

export type AppendLogAdapter = {
  kind: 'append_log';
  id: AdapterId;
  parserVersion: number;
  discover(): string[];
  initialCarry(path: string): unknown;
  parseLines(lines: readonly string[], storedCarry: unknown): { batch: Batch; carry: unknown };
};

export type SnapshotAdapter = {
  kind: 'snapshot';
  id: AdapterId;
  parserVersion: number;
  discover(): string[];
  fingerprint(path: string): string;
  readAll(path: string): Batch;
};

export type SourceAdapter = AppendLogAdapter | SnapshotAdapter;

export function appendLog<Carry>(spec: AppendLogSpec<Carry>): AppendLogAdapter {
  throw new Error('not implemented');
}
