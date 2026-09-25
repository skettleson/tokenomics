import type { Speed, TokenVector } from './snapshot.ts';

export type PriceSource = 'list' | 'placeholder';
export const MODEL_TIERS = ['premium', 'standard', 'small', 'unknown'] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

export type Rates = Readonly<{ input: number; output: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number }>;

export type PriceEntry = Readonly<{
  id: string;
  match: readonly string[];
  tier: Exclude<ModelTier, 'unknown'>;
  source: PriceSource;
  usdPerMTok: Rates;
  fastMultiplier: number | null;
  downshift: string | null;
}>;

export type PriceResolution = { kind: 'priced'; entry: PriceEntry } | { kind: 'unpriced' };

type AnthropicSpec = {
  id: string;
  match?: readonly string[];
  input: number;
  output: number;
  cacheRead: number;
  tier: PriceEntry['tier'];
  fastMultiplier?: number;
  downshift?: string;
};

function anthropic(spec: AnthropicSpec): PriceEntry {
  return {
    id: spec.id,
    match: [spec.id, ...(spec.match ?? [])],
    tier: spec.tier,
    source: 'list',
    usdPerMTok: {
      input: spec.input,
      output: spec.output,
      cacheWrite5m: spec.input * 1.25,
      cacheWrite1h: spec.input * 2,
      cacheRead: spec.cacheRead,
    },
    fastMultiplier: spec.fastMultiplier ?? null,
    downshift: spec.downshift ?? null,
  };
}

function placeholder(id: string, match: readonly string[], input: number, output: number, cacheRead: number, tier: PriceEntry['tier']): PriceEntry {
  return {
    id,
    match,
    tier,
    source: 'placeholder',
    usdPerMTok: { input, output, cacheWrite5m: input, cacheWrite1h: input, cacheRead },
    fastMultiplier: null,
    downshift: null,
  };
}

const PREMIUM_DOWNSHIFT = 'claude-sonnet-5';

export const PRICE_TABLE: readonly PriceEntry[] = [
  anthropic({ id: 'claude-fable-5-1', input: 10, output: 50, cacheRead: 0.25, tier: 'premium', downshift: PREMIUM_DOWNSHIFT }),
  anthropic({ id: 'claude-fable-5', input: 10, output: 50, cacheRead: 1, tier: 'premium', downshift: PREMIUM_DOWNSHIFT }),
  anthropic({ id: 'claude-opus-5-5', input: 4, output: 20, cacheRead: 0.2, tier: 'premium', fastMultiplier: 2, downshift: PREMIUM_DOWNSHIFT }),
  anthropic({ id: 'claude-opus-5', input: 5, output: 25, cacheRead: 0.5, tier: 'premium', fastMultiplier: 2, downshift: PREMIUM_DOWNSHIFT }),
  anthropic({
    id: 'claude-opus-4',
    match: ['claude-4.5-opus', 'claude-4.6-opus', 'claude-4.7-opus', 'claude-4.8-opus'],
    input: 5,
    output: 25,
    cacheRead: 0.5,
    tier: 'premium',
    downshift: PREMIUM_DOWNSHIFT,
  }),
  anthropic({ id: 'claude-sonnet-5', input: 2, output: 10, cacheRead: 0.2, tier: 'standard' }),
  anthropic({ id: 'claude-sonnet-4', match: ['claude-4.5-sonnet', 'claude-4.6-sonnet'], input: 3, output: 15, cacheRead: 0.3, tier: 'standard' }),
  anthropic({ id: 'claude-haiku-4-5', match: ['claude-4.5-haiku'], input: 1, output: 5, cacheRead: 0.1, tier: 'small' }),
  placeholder('gpt-5.6-sol', ['gpt-5.6-sol'], 1.25, 10, 0.125, 'premium'),
  placeholder('grok', ['cursor-grok-', 'grok-'], 3, 15, 0.75, 'standard'),
  placeholder('composer', ['composer-'], 1.25, 10, 0.125, 'standard'),
];

export function resolvePrice(model: string, table: readonly PriceEntry[] = PRICE_TABLE): PriceResolution {
  const name = model.toLowerCase();
  let best: PriceEntry | null = null;
  let bestLength = 0;
  for (const entry of table) {
    for (const prefix of entry.match) {
      if (prefix.length > bestLength && name.startsWith(prefix)) {
        best = entry;
        bestLength = prefix.length;
      }
    }
  }
  return best ? { kind: 'priced', entry: best } : { kind: 'unpriced' };
}

export function tierOf(resolution: PriceResolution): ModelTier {
  return resolution.kind === 'priced' ? resolution.entry.tier : 'unknown';
}

export function priceRow(entry: PriceEntry, speed: Speed, vector: TokenVector): number {
  const rates = entry.usdPerMTok;
  const perMillion =
    vector.input * rates.input +
    vector.unsplit * rates.input +
    vector.cacheWrite5m * rates.cacheWrite5m +
    vector.cacheWrite1h * rates.cacheWrite1h +
    vector.cacheRead * rates.cacheRead +
    vector.output * rates.output +
    vector.reasoning * rates.output;
  const multiplier = speed === 'fast' ? (entry.fastMultiplier ?? 1) : 1;
  return (perMillion / 1_000_000) * multiplier;
}
