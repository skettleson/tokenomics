import type { ParsedUnit, Source, SourceEvent, SourceUnit } from '../build.ts'

export const codexSource: Source = {
  id: 'codex',
  parserVersion: 1,
  discover: discoverCodexRollouts,
  parse: parseCodexRollout,
}

async function discoverCodexRollouts(home: string): Promise<readonly SourceUnit[]> {
  throw new Error('not implemented')
}

async function parseCodexRollout(unit: SourceUnit): Promise<ParsedUnit> {
  throw new Error('not implemented')
}

export interface CodexCursor {
  readonly sessionId: string | null
  readonly cwd: string | null
  readonly model: string | null
  readonly cumulativeTotal: number
}

export function stepCodexLine(cursor: CodexCursor, line: string): { cursor: CodexCursor; event: SourceEvent | null } {
  throw new Error('not implemented')
}
