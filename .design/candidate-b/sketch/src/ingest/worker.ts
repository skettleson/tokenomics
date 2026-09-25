import type { IngestProgress, IngestReport } from './ingest.ts';
import type { WarehousePath } from '../warehouse/warehouse.ts';

export type ToIngestWorker = { kind: 'refresh' };
export type FromIngestWorker = IngestProgress;

export type IngestWorkerData = {
  warehousePath: WarehousePath;
  pollIntervalMs: number;
};

export type IngestHandle = {
  refresh(): void;
  status(): IngestStatus;
};

export type IngestStatus =
  | { kind: 'idle'; lastReport: IngestReport | null }
  | { kind: 'running'; done: number; total: number; rerunQueued: boolean };

export function startIngestWorker(data: IngestWorkerData): IngestHandle {
  throw new Error('not implemented');
}

function runWorkerLoop(data: IngestWorkerData): void {
  throw new Error('not implemented');
}
