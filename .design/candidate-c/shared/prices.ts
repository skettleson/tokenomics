import type { Speed, TokenVector } from './snapshot.ts';

export type PriceSource = 'published' | 'placeholder';
export type ModelTier = 'premium' | 'standard' | 'economy';

export type Price = {
  usdPerMTok: { input: number; output: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number };
  fastMultiplier: number;
  tier: ModelTier;
  source: PriceSource;
};

export type PriceResolution =
  | { kind: 'priced'; matchedPrefix: string; price: Price }
  | { kind: 'unpriced' };

function anthropic(input: number, output: number, cacheRead: number, tier: ModelTier, fastMultiplier = 2): Price {
  return {
    usdPerMTok: { input, output, cacheWrite5m: input * 1.25, cacheWrite1h: input * 2, cacheRead },
    fastMultiplier,
    tier,
    source: 'published',
  };
}

function placeholder(input: number, output: number, cacheRead: number, tier: ModelTier): Price {
  return {
    usdPerMTok: { input, output, cacheWrite5m: input, cacheWrite1h: input, cacheRead },
    fastMultiplier: 1,
    tier,
    source: 'placeholder',
  };
}

export const PRICE_TABLE: Readonly<Record<string, Price>> = {
  'claude-fable-5-1': anthropic(10, 50, 0.25, 'premium'),
  'claude-fable-5': anthropic(10, 50, 1, 'premium'),
  'claude-opus-5-5': anthropic(4, 20, 0.2, 'premium'),
  'claude-opus-5': anthropic(5, 25, 0.5, 'premium'),
  'claude-opus-4': anthropic(5, 25, 0.5, 'premium'),
  'claude-sonnet-5': anthropic(2, 10, 0.2, 'standard'),
  'claude-sonnet-4': anthropic(3, 15, 0.3, 'standard'),
  'claude-haiku-4-5': anthropic(1, 5, 0.1, 'economy'),
  'gpt-5.6-sol': placeholder(1.25, 10, 0.125, 'premium'),
  'cursor-grok-': placeholder(3, 15, 0.75, 'standard'),
  'grok-': placeholder(3, 15, 0.75, 'standard'),
  'composer-': placeholder(1.25, 10, 0.125, 'standard'),
};

export function resolvePrice(model: string): PriceResolution {
  throw new Error('not implemented');
}

export function costUsd(price: Price, speed: Speed, tokens: TokenVector): number {
  throw new Error('not implemented');
}
