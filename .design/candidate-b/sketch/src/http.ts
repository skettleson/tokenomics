import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Analytics } from './analytics/analytics.ts';
import type { IngestHandle } from './ingest/worker.ts';

export type ServerDeps = {
  analytics: Analytics;
  ingest: IngestHandle;
  publicDir: string;
  now: () => number;
};

type Route = {
  method: 'GET' | 'POST';
  path: string;
  handle(url: URL, deps: ServerDeps): unknown;
};

export const ROUTES: readonly Route[] = [
  { method: 'GET', path: '/api/meta', handle: (_url, deps) => ({ ...deps.analytics.meta(), ingest: deps.ingest.status() }) },
  { method: 'GET', path: '/api/dashboard', handle: dashboardRoute },
  { method: 'POST', path: '/api/refresh', handle: (_url, deps) => { deps.ingest.refresh(); return deps.ingest.status(); } },
];

function dashboardRoute(url: URL, deps: ServerDeps): unknown {
  throw new Error('not implemented');
}

export function startServer(deps: ServerDeps, port: number): Server {
  throw new Error('not implemented');
}

function serveStatic(req: IncomingMessage, res: ServerResponse, publicDir: string): void {
  throw new Error('not implemented');
}
