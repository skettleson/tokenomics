import type { Cost, ModelId, ModelTier, PriceEntry, PriceTable, Speed, Tokens } from './domain.ts'

export interface ResolvedModel {
  readonly model: ModelId
  readonly tier: ModelTier
  readonly price: PriceEntry | null
}

export function parsePriceTable(json: unknown): PriceTable {
  throw new Error('not implemented')
}

export function resolveModel(table: PriceTable, rawModel: string): ResolvedModel {
  throw new Error('not implemented')
}

export function priceTokens(price: PriceEntry | null, tokens: Tokens, speed: Speed, reportedUsd: number | null): Cost {
  throw new Error('not implemented')
}

export function repriceAs(table: PriceTable, target: ModelId, tokens: Tokens): number {
  throw new Error('not implemented')
}
