import { createAnalytics } from './analytics/analytics.ts';
import { startServer } from './http.ts';
import { startIngestWorker } from './ingest/worker.ts';
import { defaultWarehousePath, openReader } from './warehouse/warehouse.ts';

export type Config = {
  port: number;
  warehousePath: ReturnType<typeof defaultWarehousePath>;
  pollIntervalMs: number;
};

export function readConfig(env: NodeJS.ProcessEnv): Config {
  throw new Error('not implemented');
}

export function main(): void {
  const config = readConfig(process.env);
  const ingest = startIngestWorker({ warehousePath: config.warehousePath, pollIntervalMs: config.pollIntervalMs });
  const analytics = createAnalytics(openReader(config.warehousePath));
  startServer({ analytics, ingest, publicDir: new URL('../public', import.meta.url).pathname, now: Date.now }, config.port);
}

main();
