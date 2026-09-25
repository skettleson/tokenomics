import type { Env, Harvest, SessionFact, Source, UsageFact } from '../compile.ts';

type ClaudeFileParse = {
  session: SessionFact | null;
  responsesByMessageId: Map<string, UsageFact>;
};

export function claudeCodeSource(): Source {
  return {
    tool: 'claude-code',
    harvest: (env: Env): Promise<Harvest> => {
      throw new Error('not implemented');
    },
  };
}

export function parseClaudeTranscript(text: string): ClaudeFileParse {
  throw new Error('not implemented');
}

export function mergeClaudeFiles(files: readonly ClaudeFileParse[]): { sessions: SessionFact[]; usage: UsageFact[] } {
  throw new Error('not implemented');
}
