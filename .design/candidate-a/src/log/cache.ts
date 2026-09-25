import type { ParsedUnit, Source, SourceUnit } from './build.ts'

export interface CacheEntry {
  readonly stamp: string
  readonly parsed: ParsedUnit
}

export type ParseCache = ReadonlyMap<string, CacheEntry>

export function cacheKey(source: Source, unit: SourceUnit): string {
  throw new Error('not implemented')
}

export async function loadCache(file: string): Promise<ParseCache> {
  throw new Error('not implemented')
}

export async function saveCache(file: string, cache: ParseCache): Promise<void> {
  throw new Error('not implemented')
}
