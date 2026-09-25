import type { EventLog } from './domain.ts'

export interface WireLog {
  readonly version: string
  readonly builtAt: number
  readonly dictionaries: Readonly<Record<'tool' | 'session' | 'project' | 'model' | 'tier' | 'agent' | 'speed' | 'fidelity' | 'priceSource', readonly string[]>>
  readonly columns: Readonly<Record<string, readonly number[]>>
  readonly sessions: readonly (readonly [string, string, string | null])[]
  readonly prices: unknown
  readonly warnings: unknown
}

export function encodeLog(log: EventLog): WireLog {
  throw new Error('not implemented')
}

export function decodeLog(wire: unknown): EventLog {
  throw new Error('not implemented')
}
