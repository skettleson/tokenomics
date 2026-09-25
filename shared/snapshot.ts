export const TOOLS = ['claude-code', 'codex', 'cursor'] as const;
export type Tool = (typeof TOOLS)[number];

export const SOURCE_IDS = ['claude-code', 'codex', 'cursor', 'cursor-csv'] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export const TOKEN_KINDS = ['input', 'cacheWrite5m', 'cacheWrite1h', 'cacheRead', 'output', 'reasoning', 'unsplit'] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];
export type TokenVector = Readonly<Record<TokenKind, number>>;

export const FIDELITIES = ['measured', 'total-only', 'estimated'] as const;
export type Fidelity = (typeof FIDELITIES)[number];

export const SPEEDS = ['standard', 'fast'] as const;
export type Speed = (typeof SPEEDS)[number];

export const AGENTS = ['main', 'subagent'] as const;
export type Agent = (typeof AGENTS)[number];

export const SESSION_KINDS = ['conversation', 'billingDay'] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export type SourceReport =
  | {
      source: SourceId;
      tool: Tool;
      status: 'ok';
      filesSeen: number;
      filesParsed: number;
      filesRetained: number;
      sessions: number;
      requests: number;
      retainedRequests: number;
      fidelity: Record<Fidelity, number>;
      notes: string[];
    }
  | { source: SourceId; tool: Tool; status: 'missing'; lookedAt: string; filesRetained: number; retainedRequests: number }
  | { source: SourceId; tool: Tool; status: 'failed'; error: string };

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
    agent: number[];
    fidelity: number[];
    reportedCostMicroUsd: (number | null)[];
    tokens: Record<TokenKind, number[]>;
  };
};

export type SnapshotParse = { ok: true; snapshot: SnapshotV1 } | { ok: false; reason: string };

export const EMPTY_TOKENS: TokenVector = Object.freeze({
  input: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
  output: 0,
  reasoning: 0,
  unsplit: 0,
});

export function tokens(partial: Partial<Record<TokenKind, number>>): TokenVector {
  return { ...EMPTY_TOKENS, ...partial };
}

export function totalTokens(vector: TokenVector): number {
  let sum = 0;
  for (const kind of TOKEN_KINDS) sum += vector[kind];
  return sum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function columnLengthMismatch(table: Record<string, unknown>, names: readonly string[], expected: number): string | null {
  for (const name of names) {
    const column = table[name];
    if (!Array.isArray(column)) return `column ${name} is missing`;
    if (column.length !== expected) return `column ${name} has ${column.length} rows, expected ${expected}`;
  }
  return null;
}

export function parseSnapshot(json: unknown): SnapshotParse {
  if (!isRecord(json)) return { ok: false, reason: 'snapshot is not an object' };
  if (json.version !== 1) return { ok: false, reason: `unsupported snapshot version ${String(json.version)}` };
  if (!Array.isArray(json.models) || !Array.isArray(json.projects) || !Array.isArray(json.sources)) {
    return { ok: false, reason: 'snapshot dictionaries are missing' };
  }
  const sessions = json.sessions;
  const requests = json.requests;
  if (!isRecord(sessions) || !isRecord(requests)) return { ok: false, reason: 'snapshot tables are missing' };
  const sessionCount = Array.isArray(sessions.id) ? sessions.id.length : -1;
  const sessionProblem = columnLengthMismatch(sessions, ['id', 'tool', 'kind', 'project', 'title', 'humanTurns'], sessionCount);
  if (sessionProblem) return { ok: false, reason: `sessions: ${sessionProblem}` };
  const requestCount = Array.isArray(requests.atSec) ? requests.atSec.length : -1;
  const requestProblem = columnLengthMismatch(
    requests,
    ['atSec', 'session', 'model', 'speed', 'agent', 'fidelity', 'reportedCostMicroUsd'],
    requestCount,
  );
  if (requestProblem) return { ok: false, reason: `requests: ${requestProblem}` };
  if (!isRecord(requests.tokens)) return { ok: false, reason: 'requests: token columns are missing' };
  const tokenProblem = columnLengthMismatch(requests.tokens, TOKEN_KINDS, requestCount);
  if (tokenProblem) return { ok: false, reason: `tokens: ${tokenProblem}` };
  return { ok: true, snapshot: json as SnapshotV1 };
}
