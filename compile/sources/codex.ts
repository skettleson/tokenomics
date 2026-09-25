import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tokens } from '../../shared/snapshot.ts';
import { fileStamp } from '../source.ts';
import type { Discovery, Env, FilePart, SessionPart, Source, UsageFact } from '../source.ts';

type CodexUsage = {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
};

type CodexLine = {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    id?: string;
    cwd?: string;
    model?: string;
    info?: { total_token_usage?: CodexUsage } | null;
  };
};

const UNKNOWN_MODEL = 'codex-unknown-model';

type Cumulative = Required<CodexUsage>;

const ZERO: Cumulative = {
  input_tokens: 0,
  cached_input_tokens: 0,
  cache_write_input_tokens: 0,
  output_tokens: 0,
  reasoning_output_tokens: 0,
  total_tokens: 0,
};

function cumulative(usage: CodexUsage): Cumulative {
  return {
    input_tokens: usage.input_tokens ?? 0,
    cached_input_tokens: usage.cached_input_tokens ?? 0,
    cache_write_input_tokens: usage.cache_write_input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    reasoning_output_tokens: usage.reasoning_output_tokens ?? 0,
    total_tokens: usage.total_tokens ?? 0,
  };
}

export function codexDeltaTokens(previous: Cumulative, current: Cumulative) {
  const delta = (field: keyof Cumulative) => Math.max(0, current[field] - previous[field]);
  const input = delta('input_tokens');
  const cached = Math.min(delta('cached_input_tokens'), input);
  const cacheWrite = Math.min(delta('cache_write_input_tokens'), input - cached);
  const output = delta('output_tokens');
  const reasoning = Math.min(delta('reasoning_output_tokens'), output);
  const total = delta('total_tokens');
  if (input + output === 0) {
    return { fidelity: 'total-only' as const, tokens: tokens({ unsplit: total }) };
  }
  return {
    fidelity: 'measured' as const,
    tokens: tokens({ input: input - cached - cacheWrite, cacheRead: cached, cacheWrite5m: cacheWrite, output: output - reasoning, reasoning }),
  };
}

export function parseCodexRollout(text: string): FilePart {
  const sessions = new Map<string, SessionPart>();
  const usage: UsageFact[] = [];
  let session: SessionPart | null = null;
  let model = UNKNOWN_MODEL;
  let previous: Cumulative = ZERO;
  for (const raw of text.split('\n')) {
    if (!raw) continue;
    let line: CodexLine;
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    const payload = line.payload;
    if (!payload) continue;
    if (line.type === 'session_meta' && payload.id) {
      const key = `codex:${payload.id}`;
      session = sessions.get(key) ?? {
        key,
        tool: 'codex',
        kind: 'conversation',
        projectPath: payload.cwd ?? null,
        title: null,
        titleRank: 0,
        humanTurnIds: [],
      };
      sessions.set(key, session);
      previous = ZERO;
      continue;
    }
    if (line.type === 'turn_context') {
      if (payload.model) model = payload.model;
      continue;
    }
    if (line.type !== 'event_msg' || !session) continue;
    if (payload.type === 'user_message') {
      session.humanTurnIds.push(`${session.key}:${line.timestamp ?? session.humanTurnIds.length}`);
      continue;
    }
    if (payload.type !== 'token_count' || !payload.info?.total_token_usage) continue;
    const current = cumulative(payload.info.total_token_usage);
    const atMs = Date.parse(line.timestamp ?? '');
    if (current.total_tokens <= previous.total_tokens || Number.isNaN(atMs)) continue;
    const { fidelity, tokens: vector } = codexDeltaTokens(previous, current);
    usage.push({
      key: `${session.key}:${current.total_tokens}`,
      sessionKey: session.key,
      atMs,
      model,
      speed: 'standard',
      agent: 'main',
      fidelity,
      tokens: vector,
      reportedCostUsd: null,
    });
    previous = current;
  }
  return { sessions: [...sessions.values()], usage };
}

async function discover(env: Env): Promise<Discovery> {
  const root = join(env.home, '.codex', 'sessions');
  let names: string[];
  try {
    names = await readdir(root, { recursive: true });
  } catch {
    return { kind: 'missing', lookedAt: root };
  }
  const paths = names.filter((name) => name.endsWith('.jsonl')).map((name) => join(root, name)).sort();
  return { kind: 'found', files: await Promise.all(paths.map(async (path) => ({ path, stamp: await fileStamp(path) }))) };
}

async function sessionTitles(env: Env): Promise<ReadonlyMap<string, string>> {
  const titles = new Map<string, string>();
  const text = await readFile(join(env.home, '.codex', 'session_index.jsonl'), 'utf8');
  for (const raw of text.split('\n')) {
    try {
      const entry = JSON.parse(raw) as { id?: string; thread_name?: string };
      if (entry.id && entry.thread_name) titles.set(`codex:${entry.id}`, entry.thread_name);
    } catch {}
  }
  return titles;
}

export const codexSource: Source = {
  id: 'codex',
  tool: 'codex',
  parserVersion: 1,
  discover,
  async parseFile(path) {
    return parseCodexRollout(await readFile(path, 'utf8'));
  },
  sessionTitles,
};
