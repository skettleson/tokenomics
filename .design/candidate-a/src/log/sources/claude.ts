import type { ParsedUnit, Source, SourceEvent, SourceUnit } from '../build.ts'

export const claudeSource: Source = {
  id: 'claude-code',
  parserVersion: 1,
  discover: discoverClaudeFiles,
  parse: parseClaudeFile,
}

async function discoverClaudeFiles(home: string): Promise<readonly SourceUnit[]> {
  throw new Error('not implemented')
}

async function parseClaudeFile(unit: SourceUnit): Promise<ParsedUnit> {
  throw new Error('not implemented')
}

export type ClaudeLine =
  | { readonly kind: 'response'; readonly event: SourceEvent }
  | { readonly kind: 'title'; readonly sessionId: string; readonly title: string }
  | { readonly kind: 'skip' }

export function parseClaudeLine(line: string, isSubagentFile: boolean): ClaudeLine {
  throw new Error('not implemented')
}
