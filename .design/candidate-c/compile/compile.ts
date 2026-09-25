import type { Fidelity, SessionKind, SnapshotV1, SourceReport, Speed, Tool, TokenVector } from '../shared/snapshot.ts';
import { claudeCodeSource } from './sources/claude.ts';
import { codexSource } from './sources/codex.ts';
import { cursorSource } from './sources/cursor.ts';

export type Env = {
  home: string;
  cursorUsageCsvDir: string;
};

export type SessionFact = {
  key: string;
  tool: Tool;
  kind: SessionKind;
  projectPath: string | null;
  title: string | null;
  humanTurns: number;
};

export type UsageFact = {
  sessionKey: string;
  atMs: number;
  model: string;
  speed: Speed;
  fidelity: Fidelity;
  tokens: TokenVector;
  reportedCostUsd: number | null;
};

export type Harvest = {
  sessions: SessionFact[];
  usage: UsageFact[];
  report: SourceReport;
};

export type Source = {
  tool: Tool;
  harvest(env: Env): Promise<Harvest>;
};

export type Compiler = {
  compile(): Promise<SnapshotV1>;
};

export function createCompiler(env: Env): Compiler {
  const sources: readonly Source[] = [claudeCodeSource(), codexSource(), cursorSource()];
  throw new Error('not implemented');
}

export function encodeSnapshot(harvests: readonly Harvest[], builtAt: Date): SnapshotV1 {
  throw new Error('not implemented');
}

export async function writeSnapshotAtomically(path: string, snapshot: SnapshotV1): Promise<void> {
  throw new Error('not implemented');
}

export type FileMemo<T> = {
  read(path: string, parse: (text: string) => T): Promise<T>;
};

export function createFileMemo<T>(): FileMemo<T> {
  throw new Error('not implemented');
}
