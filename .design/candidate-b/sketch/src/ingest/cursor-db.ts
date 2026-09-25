import type { Batch, SplitTokens } from '../domain.ts';
import type { SnapshotAdapter } from './adapters.ts';

type ComposerRecord = {
  composerId: string;
  createdAtMs: number;
  modelName: string;
  name: string | null;
  contextTokensUsed: number | null;
  subComposerIds: string[];
  bubbles: BubbleRecord[];
};

type BubbleRecord = {
  bubbleId: string;
  role: 'user' | 'assistant';
  createdAtMs: number;
  reportedTokens: { input: number; output: number } | null;
  textChars: number;
  toolResultChars: number;
};

export const cursorDb: SnapshotAdapter = {
  kind: 'snapshot',
  id: 'cursor_db',
  parserVersion: 1,
  discover: discoverCursorStateDb,
  fingerprint: fingerprintByStat,
  readAll: readCursorComposers,
};

function discoverCursorStateDb(): string[] {
  throw new Error('not implemented');
}

function fingerprintByStat(path: string): string {
  throw new Error('not implemented');
}

function readCursorComposers(path: string): Batch {
  throw new Error('not implemented');
}

export function estimateAssistantBubble(composer: ComposerRecord, bubbleIndex: number): SplitTokens {
  throw new Error('not implemented');
}
