import type { Batch, ModelName, SessionKey } from '../domain.ts';
import { appendLog } from './adapters.ts';

type CodexCarry = {
  session: SessionKey | null;
  model: ModelName | null;
  cumulativeTotal: number;
};

export const codex = appendLog<CodexCarry>({
  id: 'codex',
  parserVersion: 1,
  discover: discoverRollouts,
  initialCarry: () => ({ session: null, model: null, cumulativeTotal: 0 }),
  parseCarry: parseCodexCarry,
  parseLines: parseRolloutLines,
});

function discoverRollouts(): string[] {
  throw new Error('not implemented');
}

function parseCodexCarry(stored: unknown): CodexCarry {
  throw new Error('not implemented');
}

function parseRolloutLines(lines: readonly string[], carry: CodexCarry): { batch: Batch; carry: CodexCarry } {
  throw new Error('not implemented');
}

export function readThreadTitles(stateDbPath: string, sessionIndexPath: string): Map<string, string> {
  throw new Error('not implemented');
}
