import type { Batch, RequestFact, SessionDim } from '../domain.ts';
import { appendLog } from './adapters.ts';

type ClaudeCarry = { sessionKey: string | null };

type ClaudeLine =
  | { kind: 'assistant_usage'; fact: RequestFact; session: SessionDim }
  | { kind: 'title'; session: SessionDim }
  | { kind: 'ignored' };

export const claudeCode = appendLog<ClaudeCarry>({
  id: 'claude_code',
  parserVersion: 1,
  discover: discoverClaudeTranscripts,
  initialCarry: () => ({ sessionKey: null }),
  parseCarry: parseClaudeCarry,
  parseLines: parseClaudeLines,
});

function discoverClaudeTranscripts(): string[] {
  throw new Error('not implemented');
}

function parseClaudeCarry(stored: unknown): ClaudeCarry {
  throw new Error('not implemented');
}

function parseClaudeLines(lines: readonly string[], carry: ClaudeCarry): { batch: Batch; carry: ClaudeCarry } {
  throw new Error('not implemented');
}

export function classifyClaudeLine(raw: unknown): ClaudeLine {
  throw new Error('not implemented');
}
