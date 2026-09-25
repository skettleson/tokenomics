export type Tool = 'claude-code' | 'codex' | 'cursor'

export type EpochMs = number & { readonly __brand: 'EpochMs' }
export type EventKey = string & { readonly __brand: 'EventKey' }
export type SessionKey = string & { readonly __brand: 'SessionKey' }
export type ProjectKey = string & { readonly __brand: 'ProjectKey' }
export type ModelId = string & { readonly __brand: 'ModelId' }

export type TokenFidelity = 'measured' | 'total-only' | 'estimated'
export type PriceSource = 'list' | 'placeholder' | 'reported' | 'unpriced'
export type ModelTier = 'frontier' | 'mid' | 'small' | 'unknown'
export type Agent = 'main' | 'subagent'
export type Speed = 'standard' | 'fast'

export const TOKEN_KINDS = ['input', 'cacheWrite5m', 'cacheWrite1h', 'cacheRead', 'output', 'unsplit'] as const
export type TokenKind = (typeof TOKEN_KINDS)[number]
export type Tokens = Readonly<Record<TokenKind, number>>

export interface Cost {
  readonly usd: number
  readonly source: PriceSource
}

export interface UsageEvent {
  readonly key: EventKey
  readonly tool: Tool
  readonly at: EpochMs
  readonly session: SessionKey
  readonly project: ProjectKey
  readonly model: ModelId
  readonly tier: ModelTier
  readonly agent: Agent
  readonly speed: Speed
  readonly tokens: Tokens
  readonly fidelity: TokenFidelity
  readonly cost: Cost
}

export interface SessionMeta {
  readonly key: SessionKey
  readonly tool: Tool
  readonly title: string | null
}

export interface PriceEntry {
  readonly match: string
  readonly model: ModelId
  readonly tier: ModelTier
  readonly source: 'list' | 'placeholder'
  readonly usdPerMTok: Readonly<Record<Exclude<TokenKind, 'unsplit'>, number>>
  readonly fastMultiplier: number | null
}

export interface PriceTable {
  readonly entries: readonly PriceEntry[]
}

export interface SourceWarning {
  readonly source: string
  readonly path: string
  readonly message: string
}

export interface EventLog {
  readonly version: string
  readonly builtAt: EpochMs
  readonly events: readonly UsageEvent[]
  readonly sessions: ReadonlyMap<SessionKey, SessionMeta>
  readonly prices: PriceTable
  readonly warnings: readonly SourceWarning[]
}

export function tokensExact(event: UsageEvent): boolean {
  throw new Error('not implemented')
}

export function costExact(event: UsageEvent): boolean {
  throw new Error('not implemented')
}

export function totalTokens(tokens: Tokens): number {
  throw new Error('not implemented')
}

export function inputSideTokens(tokens: Tokens): number {
  throw new Error('not implemented')
}
