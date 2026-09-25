import type { ParsedUnit, Source, SourceEvent, SourceUnit } from '../build.ts'

export const cursorSource: Source = {
  id: 'cursor',
  parserVersion: 1,
  discover: discoverCursorDb,
  parse: parseCursorDb,
}

async function discoverCursorDb(home: string): Promise<readonly SourceUnit[]> {
  throw new Error('not implemented')
}

async function parseCursorDb(unit: SourceUnit): Promise<ParsedUnit> {
  throw new Error('not implemented')
}

export interface CursorComposer {
  readonly composerId: string
  readonly name: string | null
  readonly modelName: string
  readonly workspacePath: string | null
  readonly isSubComposer: boolean
}

export interface CursorBubble {
  readonly bubbleId: string
  readonly role: 'user' | 'assistant'
  readonly createdAt: number
  readonly textLength: number
  readonly reportedInput: number
  readonly reportedOutput: number
}

export function cursorEvents(composer: CursorComposer, bubbles: readonly CursorBubble[]): SourceEvent[] {
  throw new Error('not implemented')
}
