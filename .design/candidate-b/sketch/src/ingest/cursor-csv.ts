import type { Batch } from '../domain.ts';
import type { SnapshotAdapter } from './adapters.ts';

type CursorUsageRow = {
  date: string;
  kind: string;
  model: string;
  maxMode: boolean;
  inputWithCacheWrite: number;
  inputWithoutCacheWrite: number;
  cacheRead: number;
  output: number;
  total: number;
  costUsd: number | null;
};

export const cursorCsv: SnapshotAdapter = {
  kind: 'snapshot',
  id: 'cursor_csv',
  parserVersion: 1,
  discover: discoverImportedCsvs,
  fingerprint: fingerprintByContentHash,
  readAll: readCursorUsageCsv,
};

function discoverImportedCsvs(): string[] {
  throw new Error('not implemented');
}

function fingerprintByContentHash(path: string): string {
  throw new Error('not implemented');
}

function readCursorUsageCsv(path: string): Batch {
  throw new Error('not implemented');
}

export function parseCursorUsageCsv(text: string): CursorUsageRow[] {
  throw new Error('not implemented');
}
