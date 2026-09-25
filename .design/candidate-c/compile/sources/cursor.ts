import type { Env, Harvest, SessionFact, Source, UsageFact } from '../compile.ts';

type ComposerRow = {
  composerId: string;
  name: string | null;
  modelName: string;
  createdAtMs: number;
  contextTokensUsed: number | null;
  bubbles: { type: 'user' | 'assistant'; createdAtMs: number; textLength: number }[];
};

type UsageExportRow = {
  day: string;
  model: string;
  maxMode: boolean;
  inputWithCacheWrite: number;
  inputWithoutCacheWrite: number;
  cacheRead: number;
  output: number;
  costUsd: number | null;
};

export function cursorSource(): Source {
  return {
    tool: 'cursor',
    harvest: (env: Env): Promise<Harvest> => {
      throw new Error('not implemented');
    },
  };
}

export function readComposers(stateDbPath: string): ComposerRow[] {
  throw new Error('not implemented');
}

export function estimateComposerUsage(composer: ComposerRow): { session: SessionFact; usage: UsageFact[] } {
  throw new Error('not implemented');
}

export function parseUsageExportCsv(text: string): UsageExportRow[] {
  throw new Error('not implemented');
}

export function measuredUsageFromExport(rows: readonly UsageExportRow[]): { sessions: SessionFact[]; usage: UsageFact[] } {
  throw new Error('not implemented');
}

export function supersedeEstimatesByMeasuredDays(estimated: readonly UsageFact[], measured: readonly UsageFact[]): UsageFact[] {
  throw new Error('not implemented');
}
