import type { Day, SessionKey, Tool } from '../domain.ts';

export type Filter = {
  from: Day | null;
  to: Day | null;
  tools: readonly Tool[];
  projects: readonly number[];
  models: readonly number[];
  sessions: readonly SessionKey[];
  fidelity: 'all' | 'measured_only';
  sidechains: 'include' | 'exclude';
};

export type FilterPatch = Partial<Filter>;

export type Bucket = 'hour' | 'day' | 'week';

export type SqlParams = Record<string, string | number | null>;

export type CompiledFilter = {
  where: string;
  params: SqlParams;
};

export const DEFAULT_FILTER: Filter = {
  from: null,
  to: null,
  tools: [],
  projects: [],
  models: [],
  sessions: [],
  fidelity: 'all',
  sidechains: 'include',
};

export function parseFilter(query: URLSearchParams): Filter {
  throw new Error('not implemented');
}

export function filterToQuery(filter: Filter): URLSearchParams {
  throw new Error('not implemented');
}

export function applyPatch(filter: Filter, patch: FilterPatch): Filter {
  throw new Error('not implemented');
}

export function compileFilter(filter: Filter, extra: { measuredOnly: boolean }): CompiledFilter {
  throw new Error('not implemented');
}

export function chooseBucket(firstDay: Day, lastDay: Day): Bucket {
  throw new Error('not implemented');
}

export function bucketExpression(bucket: Bucket): string {
  throw new Error('not implemented');
}
