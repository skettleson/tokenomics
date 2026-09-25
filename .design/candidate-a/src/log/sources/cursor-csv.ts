import type { ParsedUnit, Source, SourceUnit } from '../build.ts'

export const cursorCsvSource: Source = {
  id: 'cursor-csv',
  parserVersion: 1,
  discover: discoverCursorCsvExports,
  parse: parseCursorCsvExport,
}

async function discoverCursorCsvExports(home: string): Promise<readonly SourceUnit[]> {
  throw new Error('not implemented')
}

async function parseCursorCsvExport(unit: SourceUnit): Promise<ParsedUnit> {
  throw new Error('not implemented')
}
