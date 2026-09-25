import type { Server } from 'node:http';
import type { Compiler } from './compile/compile.ts';

export type ServerOptions = {
  port: number;
  appRoot: string;
  snapshotPath: string;
  compiler: Compiler;
};

export type Route =
  | { kind: 'page' }
  | { kind: 'module'; path: string }
  | { kind: 'snapshot' }
  | { kind: 'rebuild' }
  | { kind: 'notFound' };

export function routeOf(method: string, url: string): Route {
  throw new Error('not implemented');
}

export function startServer(options: ServerOptions): Promise<Server> {
  throw new Error('not implemented');
}

export type Rebuilder = {
  rebuild(): Promise<{ builtAt: string }>;
  ready(): Promise<void>;
};

export function createRebuilder(compiler: Compiler, snapshotPath: string): Rebuilder {
  throw new Error('not implemented');
}
