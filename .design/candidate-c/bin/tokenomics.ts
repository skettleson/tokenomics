import type { Env } from '../compile/compile.ts';

export type Command =
  | { kind: 'build'; out: string }
  | { kind: 'serve'; port: number; snapshotPath: string }
  | { kind: 'usage'; message: string };

export function parseArgs(argv: readonly string[], env: Env): Command {
  throw new Error('not implemented');
}

export async function main(argv: readonly string[]): Promise<number> {
  throw new Error('not implemented');
}
