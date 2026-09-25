import type { Agent, EpochMs, EventKey, EventLog, PriceTable, ProjectKey, SessionKey, SessionMeta, SourceWarning, Speed, TokenFidelity, Tokens, Tool, UsageEvent } from '../domain.ts'
import { loadCache, saveCache } from './cache.ts'
import { claudeSource } from './sources/claude.ts'
import { codexSource } from './sources/codex.ts'
import { cursorSource } from './sources/cursor.ts'
import { cursorCsvSource } from './sources/cursor-csv.ts'

export interface SourceUnit {
  readonly path: string
  readonly stamp: string
}

export interface SourceEvent {
  readonly key: EventKey
  readonly tool: Tool
  readonly at: EpochMs
  readonly sessionId: string
  readonly cwd: string | null
  readonly rawModel: string
  readonly agent: Agent
  readonly speed: Speed
  readonly tokens: Tokens
  readonly fidelity: TokenFidelity
  readonly reportedUsd: number | null
}

export interface SourceSession {
  readonly sessionId: string
  readonly tool: Tool
  readonly title: string
}

export interface ParsedUnit {
  readonly events: readonly SourceEvent[]
  readonly sessions: readonly SourceSession[]
  readonly warnings: readonly SourceWarning[]
}

export interface Source {
  readonly id: string
  readonly parserVersion: number
  discover(home: string): Promise<readonly SourceUnit[]>
  parse(unit: SourceUnit): Promise<ParsedUnit>
}

export const SOURCES: readonly Source[] = [claudeSource, codexSource, cursorSource, cursorCsvSource]

export interface BuildOptions {
  readonly home: string
  readonly cacheFile: string
  readonly prices: PriceTable
  readonly sources?: readonly Source[]
}

export async function buildLog(options: BuildOptions): Promise<EventLog> {
  throw new Error('not implemented')
}

export function assembleLog(parsed: readonly ParsedUnit[], prices: PriceTable, home: string, builtAt: EpochMs): EventLog {
  throw new Error('not implemented')
}

function dedupeByKey(events: readonly SourceEvent[]): SourceEvent[] {
  throw new Error('not implemented')
}

function supersedeEstimatesWithMeasured(events: readonly SourceEvent[]): SourceEvent[] {
  throw new Error('not implemented')
}

function projectKeyFromCwd(cwd: string | null, home: string): ProjectKey {
  throw new Error('not implemented')
}

function sessionKey(tool: Tool, sessionId: string): SessionKey {
  throw new Error('not implemented')
}

function toUsageEvent(event: SourceEvent, prices: PriceTable, home: string): UsageEvent {
  throw new Error('not implemented')
}

function collectSessions(parsed: readonly ParsedUnit[], events: readonly UsageEvent[]): Map<SessionKey, SessionMeta> {
  throw new Error('not implemented')
}

function logVersion(parsed: readonly ParsedUnit[], prices: PriceTable): string {
  throw new Error('not implemented')
}
