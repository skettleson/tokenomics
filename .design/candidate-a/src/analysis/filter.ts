import type { Agent, EpochMs, EventLog, ModelId, ModelTier, ProjectKey, SessionKey, Speed, Tool } from '../domain.ts'

export interface Filter {
  readonly from: EpochMs | null
  readonly to: EpochMs | null
  readonly tools: readonly Tool[]
  readonly models: readonly ModelId[]
  readonly tiers: readonly ModelTier[]
  readonly projects: readonly ProjectKey[]
  readonly sessions: readonly SessionKey[]
  readonly agents: readonly Agent[]
  readonly speeds: readonly Speed[]
  readonly exactOnly: boolean
}

export type FilterPatch = Partial<Filter>

export const NO_FILTER: Filter = {
  from: null,
  to: null,
  tools: [],
  models: [],
  tiers: [],
  projects: [],
  sessions: [],
  agents: [],
  speeds: [],
  exactOnly: false,
}

export function select(log: EventLog, filter: Filter): EventLog {
  throw new Error('not implemented')
}

export function applyPatch(filter: Filter, patch: FilterPatch): Filter {
  throw new Error('not implemented')
}

export function filterToHash(filter: Filter): string {
  throw new Error('not implemented')
}

export function filterFromHash(hash: string): Filter {
  throw new Error('not implemented')
}
