import type { EventLog } from '../domain.ts'
import type { Filter, FilterPatch } from '../analysis/filter.ts'
import type { Finding } from '../analysis/rules.ts'

export interface AppState {
  readonly log: EventLog
  readonly filter: Filter
  readonly focused: Finding | null
}

export type AppAction =
  | { readonly kind: 'loaded'; readonly log: EventLog }
  | { readonly kind: 'patch-filter'; readonly patch: FilterPatch }
  | { readonly kind: 'clear-filter' }
  | { readonly kind: 'focus-finding'; readonly finding: Finding }
  | { readonly kind: 'hash-changed'; readonly hash: string }

export function reduce(state: AppState, action: AppAction): AppState {
  throw new Error('not implemented')
}

export function render(state: AppState, root: Document): void {
  throw new Error('not implemented')
}

async function fetchLog(): Promise<EventLog> {
  throw new Error('not implemented')
}

async function main(): Promise<void> {
  throw new Error('not implemented')
}

