import type { Env, Harvest, SessionFact, Source, UsageFact } from '../compile.ts';

export function codexSource(): Source {
  return {
    tool: 'codex',
    harvest: (env: Env): Promise<Harvest> => {
      throw new Error('not implemented');
    },
  };
}

export function parseCodexRollout(text: string, threadNames: ReadonlyMap<string, string>): { session: SessionFact; usage: UsageFact[] } {
  throw new Error('not implemented');
}
