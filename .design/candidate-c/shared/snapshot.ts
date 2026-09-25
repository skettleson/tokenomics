export const TOOLS = ['claude-code', 'codex', 'cursor'] as const;
export type Tool = (typeof TOOLS)[number];

export const TOKEN_KINDS = ['input', 'cacheWrite5m', 'cacheWrite1h', 'cacheRead', 'output', 'reasoning', 'unsplit'] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];
export type TokenVector = Readonly<Record<TokenKind, number>>;

export const FIDELITIES = ['measured', 'estimated'] as const;
export type Fidelity = (typeof FIDELITIES)[number];

export const SPEEDS = ['standard', 'fast'] as const;
export type Speed = (typeof SPEEDS)[number];

export const SESSION_KINDS = ['conversation', 'billingDay'] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export type SourceReport =
  | { tool: Tool; status: 'ok'; filesRead: number; sessions: number; requests: number; fidelity: Fidelity; notes: string[] }
  | { tool: Tool; status: 'missing'; lookedAt: string }
  | { tool: Tool; status: 'failed'; error: string };

export type SnapshotV1 = {
  version: 1;
  builtAt: string;
  sources: SourceReport[];
  models: string[];
  projects: string[];
  sessions: {
    id: string[];
    tool: number[];
    kind: number[];
    project: number[];
    title: string[];
    humanTurns: number[];
  };
  requests: {
    atSec: number[];
    session: number[];
    model: number[];
    speed: number[];
    fidelity: number[];
    reportedCostMicroUsd: number[];
    tokens: Record<TokenKind, number[]>;
  };
};

export type SnapshotParse = { ok: true; snapshot: SnapshotV1 } | { ok: false; reason: string };

export function parseSnapshot(json: unknown): SnapshotParse {
  throw new Error('not implemented');
}
