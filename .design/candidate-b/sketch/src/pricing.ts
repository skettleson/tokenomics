import type { PriceKey, Tier } from './domain.ts';

export type RatesUsdPerMTok = {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
};

export type PriceEntry = {
  key: PriceKey;
  vendor: 'anthropic' | 'openai' | 'xai' | 'cursor';
  tier: Tier;
  matches: readonly RegExp[];
  downshiftTo: PriceKey | null;
  rates: RatesUsdPerMTok;
  sourceUrl: string;
  asOf: string;
};

export const PRICE_REGISTRY: readonly PriceEntry[] = [];

export const IGNORED_MODELS: readonly string[] = ['<synthetic>'];

export function resolvePriceKey(rawModel: string, registry: readonly PriceEntry[]): PriceKey | null {
  throw new Error('not implemented');
}

export function assertRegistryComplete(registry: readonly PriceEntry[]): void {
  throw new Error('not implemented');
}
