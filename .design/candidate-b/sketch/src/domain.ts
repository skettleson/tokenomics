export type Brand<T, B extends string> = T & { readonly __brand: B };

export type Day = Brand<string, 'Day'>;
export type SessionKey = Brand<string, 'SessionKey'>;
export type SourceId = Brand<string, 'SourceId'>;
export type ProjectPath = Brand<string, 'ProjectPath'>;
export type ModelName = Brand<string, 'ModelName'>;
export type PriceKey = Brand<string, 'PriceKey'>;

export function asDay(stored: string): Day {
  throw new Error('not implemented');
}

export function asSessionKey(stored: string): SessionKey {
  throw new Error('not implemented');
}

export const TOOLS = ['claude_code', 'codex', 'cursor'] as const;
export type Tool = (typeof TOOLS)[number];

export const FIDELITIES = ['measured', 'total_only', 'estimated'] as const;
export type Fidelity = (typeof FIDELITIES)[number];

export const TIERS = ['flagship', 'standard', 'small'] as const;
export type Tier = (typeof TIERS)[number];

export type SplitTokens = {
  input: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  output: number;
  reasoningWithinOutput: number;
};

export type TokenUsage =
  | { fidelity: 'measured'; split: SplitTokens }
  | { fidelity: 'estimated'; split: SplitTokens }
  | { fidelity: 'total_only'; total: number };

export type RequestFact = {
  sourceId: SourceId;
  tool: Tool;
  session: SessionKey | null;
  model: ModelName;
  tsMs: number;
  day: Day;
  usage: TokenUsage;
  reportedCostUsd: number | null;
  isSidechain: boolean;
  toolCalls: number;
};

export const TITLE_RANKS = { none: 0, derived: 1, ai: 2, custom: 3 } as const;
export type TitleRank = (typeof TITLE_RANKS)[keyof typeof TITLE_RANKS];

export type SessionDim = {
  key: SessionKey;
  project: ProjectPath | null;
  parent: SessionKey | null;
  title: { text: string; rank: TitleRank } | null;
};

export type Batch = {
  sessions: SessionDim[];
  requests: RequestFact[];
};
