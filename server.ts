import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { join, normalize } from 'node:path';
import { writeSnapshotAtomically } from './compile/compile.ts';
import type { Compiler } from './compile/compile.ts';

export type ServerOptions = {
  port: number;
  host: string;
  appRoot: string;
  snapshotPath: string;
  rebuilder: Rebuilder;
};

export type Route =
  | { kind: 'page' }
  | { kind: 'module'; path: string }
  | { kind: 'snapshot' }
  | { kind: 'rebuild' }
  | { kind: 'notFound' };

const MODULE_DIRS = ['web', 'shared'];

export function routeOf(method: string, url: string): Route {
  const path = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  if (method === 'POST') return path === '/rebuild' ? { kind: 'rebuild' } : { kind: 'notFound' };
  if (method !== 'GET' && method !== 'HEAD') return { kind: 'notFound' };
  if (path === '/' || path === '/index.html') return { kind: 'page' };
  if (path === '/snapshot.json') return { kind: 'snapshot' };
  const relative = normalize(path).replace(/^\/+/, '');
  const [dir] = relative.split('/');
  if (MODULE_DIRS.includes(dir) && relative.endsWith('.ts') && !relative.includes('..')) return { kind: 'module', path: relative };
  return { kind: 'notFound' };
}

export type Rebuilder = {
  rebuild(): Promise<{ builtAt: string }>;
  ready(): Promise<void>;
};

export function createRebuilder(compiler: Compiler, snapshotPath: string): Rebuilder {
  let inFlight: Promise<{ builtAt: string }> | null = null;
  const rebuild = () => {
    inFlight ??= (async () => {
      try {
        const snapshot = await compiler.compile();
        await writeSnapshotAtomically(snapshotPath, snapshot);
        return { builtAt: snapshot.builtAt };
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };
  return {
    rebuild,
    async ready() {
      const exists = await stat(snapshotPath).then(() => true, () => false);
      if (!exists) await rebuild();
    },
  };
}

function send(response: ServerResponse, status: number, type: string, body: string | Buffer): void {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  response.end(body);
}

async function handle(options: ServerOptions, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const route = routeOf(request.method ?? 'GET', request.url ?? '/');
  switch (route.kind) {
    case 'page':
      return send(response, 200, 'text/html; charset=utf-8', await readFile(join(options.appRoot, 'web', 'index.html')));
    case 'module': {
      const source = await readFile(join(options.appRoot, route.path), 'utf8').catch(() => null);
      if (source === null) return send(response, 404, 'text/plain; charset=utf-8', `no module ${route.path}`);
      return send(response, 200, 'text/javascript; charset=utf-8', stripTypeScriptTypes(source, { mode: 'strip' }));
    }
    case 'snapshot': {
      await options.rebuilder.ready();
      return send(response, 200, 'application/json', await readFile(options.snapshotPath));
    }
    case 'rebuild': {
      const result = await options.rebuilder.rebuild();
      return send(response, 200, 'application/json', JSON.stringify(result));
    }
    case 'notFound':
      return send(response, 404, 'text/plain; charset=utf-8', 'not found');
  }
}

export function startServer(options: ServerOptions): Promise<Server> {
  const server = createServer((request, response) => {
    handle(options, request, response).catch((error) => {
      if (!response.headersSent) send(response, 500, 'text/plain; charset=utf-8', String(error));
      else response.end();
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => resolve(server));
  });
}
