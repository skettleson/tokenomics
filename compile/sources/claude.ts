import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tokens } from '../../shared/snapshot.ts';
import { fileStamp } from '../source.ts';
import type { Discovery, Env, FilePart, SessionPart, Source, UsageFact } from '../source.ts';

type ClaudeUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
  speed?: string;
};

type ClaudeLine = {
  type?: string;
  sessionId?: string;
  uuid?: string;
  timestamp?: string;
  cwd?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  requestId?: string;
  aiTitle?: string;
  customTitle?: string;
  message?: { id?: string; model?: string; usage?: ClaudeUsage; content?: unknown };
};

const TITLE_RANK = { 'ai-title': 1, 'custom-title': 2 } as const;
const RELEVANT_MARKERS = ['"type":"assistant"', '"type":"user"', '"type":"ai-title"', '"type":"custom-title"'];

function projectsDir(env: Env): string {
  return join(env.home, '.claude', 'projects');
}

async function discover(env: Env): Promise<Discovery> {
  const root = projectsDir(env);
  let names: string[];
  try {
    names = await readdir(root, { recursive: true });
  } catch {
    return { kind: 'missing', lookedAt: root };
  }
  const paths = names.filter((name) => name.endsWith('.jsonl')).map((name) => join(root, name)).sort();
  const files = await Promise.all(paths.map(async (path) => ({ path, stamp: await fileStamp(path) })));
  return { kind: 'found', files };
}

function isHumanPrompt(line: ClaudeLine): boolean {
  if (line.isSidechain || line.isMeta || line.isCompactSummary) return false;
  const content = line.message?.content;
  if (typeof content === 'string') return !content.startsWith('<local-command-stdout>');
  if (!Array.isArray(content)) return false;
  return content.some((block) => typeof block === 'object' && block !== null && (block as { type?: string }).type !== 'tool_result');
}

function usageTokens(usage: ClaudeUsage) {
  const cacheWriteTotal = usage.cache_creation_input_tokens ?? 0;
  const cacheWrite1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const cacheWrite5m = Math.max(usage.cache_creation?.ephemeral_5m_input_tokens ?? 0, cacheWriteTotal - cacheWrite1h);
  return tokens({
    input: usage.input_tokens ?? 0,
    cacheWrite5m,
    cacheWrite1h,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
  });
}

function sessionKey(sessionId: string): string {
  return `claude-code:${sessionId}`;
}

export function parseClaudeTranscript(text: string, isSubagentFile: boolean): FilePart {
  const sessions = new Map<string, SessionPart>();
  const usage = new Map<string, UsageFact>();
  const sessionFor = (sessionId: string): SessionPart => {
    const key = sessionKey(sessionId);
    let session = sessions.get(key);
    if (!session) {
      session = { key, tool: 'claude-code', kind: 'conversation', projectPath: null, title: null, titleRank: 0, humanTurnIds: [] };
      sessions.set(key, session);
    }
    return session;
  };
  for (const raw of text.split('\n')) {
    if (!RELEVANT_MARKERS.some((marker) => raw.includes(marker))) continue;
    let line: ClaudeLine;
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!line.sessionId) continue;
    if (line.type === 'ai-title' || line.type === 'custom-title') {
      const title = line.type === 'ai-title' ? line.aiTitle : line.customTitle;
      const session = sessionFor(line.sessionId);
      const rank = TITLE_RANK[line.type];
      if (title && rank >= session.titleRank) {
        session.title = title;
        session.titleRank = rank;
      }
      continue;
    }
    if (line.type === 'user') {
      const session = sessionFor(line.sessionId);
      if (line.cwd && !session.projectPath) session.projectPath = line.cwd;
      if (line.uuid && !isSubagentFile && isHumanPrompt(line)) session.humanTurnIds.push(line.uuid);
      continue;
    }
    if (line.type !== 'assistant') continue;
    const message = line.message;
    const reported = message?.usage;
    if (!message || !reported || !message.model || message.model === '<synthetic>') continue;
    const id = message.id ?? line.requestId;
    const atMs = Date.parse(line.timestamp ?? '');
    if (!id || Number.isNaN(atMs)) continue;
    const session = sessionFor(line.sessionId);
    if (line.cwd && !session.projectPath) session.projectPath = line.cwd;
    const fact: UsageFact = {
      key: `claude-code:${id}`,
      sessionKey: session.key,
      atMs,
      model: message.model,
      speed: reported.speed === 'fast' ? 'fast' : 'standard',
      agent: isSubagentFile || line.isSidechain ? 'subagent' : 'main',
      fidelity: 'measured',
      tokens: usageTokens(reported),
      reportedCostUsd: null,
    };
    const existing = usage.get(fact.key);
    if (!existing) {
      usage.set(fact.key, fact);
      continue;
    }
    usage.set(fact.key, {
      ...existing,
      atMs: Math.min(existing.atMs, fact.atMs),
      tokens: tokens({
        input: Math.max(existing.tokens.input, fact.tokens.input),
        cacheWrite5m: Math.max(existing.tokens.cacheWrite5m, fact.tokens.cacheWrite5m),
        cacheWrite1h: Math.max(existing.tokens.cacheWrite1h, fact.tokens.cacheWrite1h),
        cacheRead: Math.max(existing.tokens.cacheRead, fact.tokens.cacheRead),
        output: Math.max(existing.tokens.output, fact.tokens.output),
      }),
    });
  }
  return { sessions: [...sessions.values()], usage: [...usage.values()] };
}

export const claudeCodeSource: Source = {
  id: 'claude-code',
  tool: 'claude-code',
  parserVersion: 1,
  discover,
  async parseFile(path) {
    return parseClaudeTranscript(await readFile(path, 'utf8'), path.includes('/subagents/'));
  },
};
