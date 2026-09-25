import type { DatabaseSync } from 'node:sqlite';
import type { Batch, SourceId } from '../domain.ts';
import type { AdapterId, IngestCursor } from '../ingest/adapters.ts';
import type { PriceEntry } from '../pricing.ts';

export type WarehousePath = string & { readonly __brand: 'WarehousePath' };

export type SourceFileRow = {
  id: number;
  path: string;
  adapter: AdapterId;
  parserVersion: number;
  cursor: IngestCursor;
  presence: 'present' | 'missing';
};

export type WriteMode =
  | { kind: 'append' }
  | { kind: 'replace_file' };

export type Writer = {
  sourceFiles(adapter: AdapterId): SourceFileRow[];
  commitFile(
    file: { path: string; adapter: AdapterId; parserVersion: number },
    mode: WriteMode,
    batch: Batch,
    cursor: IngestCursor,
  ): { inserted: number; duplicates: number };
  recordFailure(path: string, adapter: AdapterId, error: string): void;
  markMissing(paths: string[]): void;
  syncPrices(entries: readonly PriceEntry[], resolve: (rawModel: string) => string | null): void;
};

export type Reader = {
  snapshot<T>(read: (db: DatabaseSync) => T): T;
};

export function defaultWarehousePath(): WarehousePath {
  throw new Error('not implemented');
}

export function openWriter(path: WarehousePath): Writer {
  throw new Error('not implemented');
}

export function openReader(path: WarehousePath): Reader {
  throw new Error('not implemented');
}

function migrate(db: DatabaseSync): void {
  throw new Error('not implemented');
}

function upsertBatch(db: DatabaseSync, sourceFileId: number, batch: Batch): { inserted: number; duplicates: SourceId[] } {
  throw new Error('not implemented');
}
