import { constants } from 'node:fs';
import { copyFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { tokens } from '../../shared/snapshot.ts';
import { fileStamp } from '../source.ts';
import type { Discovery, Env, FilePart, SessionPart, Source, UsageFact } from '../source.ts';

export type CursorBubble = {
  bubbleId: string;
  role: 'user' | 'assistant';
  createdAtMs: number | null;
  replyChars: number;
  contextChars: number;
  reportedInput: number;
  reportedOutput: number;
  workspaceUri: string | null;
};

export type CursorComposer = {
  composerId: string;
  name: string | null;
  modelName: string | null;
  createdAtMs: number;
  bubbles: CursorBubble[];
};

const CHARS_PER_TOKEN = 4;

export function stateDbPath(home: string): string {
  return join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
}

async function cloneForReading(path: string): Promise<{ clonePath: string; dispose: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), 'tokenomics-cursor-'));
  const clonePath = join(directory, 'state.vscdb');
  await copyFile(path, clonePath, constants.COPYFILE_FICLONE);
  const wal = `${path}-wal`;
  const walInfo = await stat(wal).catch(() => null);
  if (walInfo && walInfo.size > 0) await copyFile(wal, `${clonePath}-wal`, constants.COPYFILE_FICLONE);
  return { clonePath, dispose: () => rm(directory, { recursive: true, force: true }) };
}

type ComposerRow = { key: string; name: string | null; modelName: string | null; createdAt: number | null };
type BubbleRow = {
  key: string;
  type: number | null;
  createdAt: string | null;
  textChars: number | null;
  thinkingChars: number | null;
  toolResultChars: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  workspaceUri: string | null;
};

export function readComposers(databasePath: string): CursorComposer[] {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const composerRows = db
      .prepare(
        `SELECT key,
                json_extract(value, '$.name') AS name,
                json_extract(value, '$.modelConfig.modelName') AS modelName,
                json_extract(value, '$.createdAt') AS createdAt
         FROM cursorDiskKV WHERE key >= 'composerData:' AND key < 'composerData;'`,
      )
      .all() as ComposerRow[];
    const bubbleRows = db
      .prepare(
        `SELECT key,
                json_extract(value, '$.type') AS type,
                json_extract(value, '$.createdAt') AS createdAt,
                length(json_extract(value, '$.text')) AS textChars,
                length(json_extract(value, '$.thinking.text')) AS thinkingChars,
                length(json_extract(value, '$.toolFormerData.result')) AS toolResultChars,
                json_extract(value, '$.tokenCount.inputTokens') AS inputTokens,
                json_extract(value, '$.tokenCount.outputTokens') AS outputTokens,
                json_extract(value, '$.workspaceUris[0]') AS workspaceUri
         FROM cursorDiskKV WHERE key >= 'bubbleId:' AND key < 'bubbleId;'`,
      )
      .all() as BubbleRow[];
    const composers = new Map<string, CursorComposer>();
    for (const row of composerRows) {
      const composerId = row.key.slice('composerData:'.length);
      composers.set(composerId, {
        composerId,
        name: row.name,
        modelName: row.modelName,
        createdAtMs: row.createdAt ?? 0,
        bubbles: [],
      });
    }
    for (const row of bubbleRows) {
      const [, composerId, bubbleId] = row.key.split(':');
      const composer = composers.get(composerId);
      if (!composer || !bubbleId || (row.type !== 1 && row.type !== 2)) continue;
      const parsedAt = row.createdAt ? Date.parse(row.createdAt) : Number.NaN;
      const ownChars = (row.textChars ?? 0) + (row.thinkingChars ?? 0);
      composer.bubbles.push({
        bubbleId,
        role: row.type === 1 ? 'user' : 'assistant',
        createdAtMs: Number.isNaN(parsedAt) ? null : parsedAt,
        replyChars: ownChars,
        contextChars: ownChars + (row.toolResultChars ?? 0),
        reportedInput: row.inputTokens ?? 0,
        reportedOutput: row.outputTokens ?? 0,
        workspaceUri: row.workspaceUri,
      });
    }
    return [...composers.values()];
  } finally {
    db.close();
  }
}

function workspacePath(uri: string | null): string | null {
  if (!uri) return null;
  try {
    return fileURLToPath(uri);
  } catch {
    return null;
  }
}

export function estimateComposerUsage(composer: CursorComposer): FilePart {
  const key = `cursor:${composer.composerId}`;
  const ordered = [...composer.bubbles].sort((a, b) => (a.createdAtMs ?? composer.createdAtMs) - (b.createdAtMs ?? composer.createdAtMs));
  const session: SessionPart = {
    key,
    tool: 'cursor',
    kind: 'conversation',
    projectPath: workspacePath(ordered.find((bubble) => bubble.workspaceUri)?.workspaceUri ?? null),
    title: composer.name,
    titleRank: 1,
    humanTurnIds: ordered.filter((bubble) => bubble.role === 'user').map((bubble) => bubble.bubbleId),
  };
  const model = !composer.modelName ? 'cursor-unknown' : composer.modelName === 'default' ? 'cursor-default' : composer.modelName;
  const usage: UsageFact[] = [];
  let contextChars = 0;
  let lastAtMs = composer.createdAtMs;
  for (const bubble of ordered) {
    const atMs = bubble.createdAtMs ?? lastAtMs;
    lastAtMs = atMs;
    if (bubble.role === 'assistant') {
      const measured = bubble.reportedInput + bubble.reportedOutput > 0;
      usage.push({
        key: `${key}:${bubble.bubbleId}`,
        sessionKey: key,
        atMs,
        model,
        speed: 'standard',
        agent: 'main',
        fidelity: measured ? 'measured' : 'estimated',
        tokens: measured
          ? tokens({ input: bubble.reportedInput, output: bubble.reportedOutput })
          : tokens({ input: Math.ceil(contextChars / CHARS_PER_TOKEN), output: Math.ceil(bubble.replyChars / CHARS_PER_TOKEN) }),
        reportedCostUsd: null,
      });
    }
    contextChars += bubble.contextChars;
  }
  return { sessions: [session], usage };
}

async function discover(env: Env): Promise<Discovery> {
  const path = stateDbPath(env.home);
  const exists = await stat(path).then(() => true, () => false);
  if (!exists) return { kind: 'missing', lookedAt: path };
  return { kind: 'found', files: [{ path, stamp: await fileStamp(path, `${path}-wal`) }] };
}

export const cursorSource: Source = {
  id: 'cursor',
  tool: 'cursor',
  parserVersion: 1,
  discover,
  async parseFile(path) {
    const { clonePath, dispose } = await cloneForReading(path);
    try {
      const parts = readComposers(clonePath).map(estimateComposerUsage);
      return { sessions: parts.flatMap((part) => part.sessions), usage: parts.flatMap((part) => part.usage) };
    } finally {
      await dispose();
    }
  },
};
