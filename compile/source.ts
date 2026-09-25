import { stat } from 'node:fs/promises';
import type { Agent, Fidelity, SessionKind, SourceId, Speed, Tool, TokenVector } from '../shared/snapshot.ts';

export type Env = {
  home: string;
  importsDir: string;
  memoPath: string;
};

export type SessionPart = {
  key: string;
  tool: Tool;
  kind: SessionKind;
  projectPath: string | null;
  title: string | null;
  titleRank: number;
  humanTurnIds: string[];
};

export type UsageFact = {
  key: string;
  sessionKey: string;
  atMs: number;
  model: string;
  speed: Speed;
  agent: Agent;
  fidelity: Fidelity;
  tokens: TokenVector;
  reportedCostUsd: number | null;
};

export type FilePart = {
  sessions: SessionPart[];
  usage: UsageFact[];
};

export type SessionFact = {
  key: string;
  tool: Tool;
  kind: SessionKind;
  projectPath: string | null;
  title: string | null;
  humanTurns: number;
};

export type SourceFile = { path: string; stamp: string };

export type Discovery = { kind: 'found'; files: SourceFile[] } | { kind: 'missing'; lookedAt: string };

export type Source = {
  id: SourceId;
  tool: Tool;
  parserVersion: number;
  discover(env: Env): Promise<Discovery>;
  parseFile(path: string): Promise<FilePart>;
  sessionTitles?(env: Env): Promise<ReadonlyMap<string, string>>;
};

export async function fileStamp(...paths: string[]): Promise<string> {
  const parts: string[] = [];
  for (const path of paths) {
    try {
      const info = await stat(path);
      parts.push(`${info.size}:${Math.trunc(info.mtimeMs)}`);
    } catch {
      parts.push('absent');
    }
  }
  return parts.join('|');
}
