# Candidate C: browser-side analytics over a compact snapshot

## Problem

The app has to join three sources with very different fidelity: Claude Code JSONL (measured, but every response is written 2.3x and needs dedupe by `message.id`), Codex rollouts (measured, but most local ones only carry `total_tokens`), and Cursor's SQLite (no real token counts, so everything is an estimate unless the user drops in the dashboard CSV). Then it has to let the user correlate trends across charts. Correlation means cross-filtering: click a project and every chart and every recommendation re-derives for that project. The data is small (about 30k deduped requests after the parse), and parsing is the only expensive step (about 3 s). So the useful split is: parse once into facts, then run every slice, price, and rule interactively. Constraints this design honors: Node 26, zero npm deps, no build step, no comments, and estimated data must stay distinguishable end to end.

## Usage (caller's view)

```
$ node bin/tokenomics.ts serve            # builds ~/.tokenomics/snapshot.json if missing, serves http://localhost:4317
$ node bin/tokenomics.ts build --out s.json   # same compile, no server (cron, CI, debugging)
```

The page loads `/snapshot.json` once. Everything after that happens in the browser: clicking a bar toggles a filter, brushing the daily cost chart sets a day range, the stack toggle switches tool/model/project, and clicking a recommendation applies its evidence filters. The **Rebuild** button POSTs `/rebuild` and then refetches. The URL hash holds the filter state by label, e.g. `#project=~/code/tokenomics&day=2026-09-01..2026-09-14`, so an evidence link survives a rebuild.

Call sites the design is derived from:

```ts
const cube = loadCube(snapshot, { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
const sel = cube.select({ tool: { kind: 'keys', keys: new Set([0]) } });
const byProject = sel.without(['project']).rollup('project');
byProject.value(k, 'costUsd', 'measured');
byProject.value(k, 'costUsd', 'estimated');
```

```ts
const findings = evaluateRules({ cube, selection: sel, now: new Date() });
dispatch({ kind: 'followEvidence', finding: findings[0] });
```

```ts
const compiler = createCompiler({ home, cursorUsageCsvDir });
await writeSnapshotAtomically(path, await compiler.compile());
```

## Shape

**Snapshot = facts only** (`shared/snapshot.ts`). The snapshot is a columnar, dictionary-encoded JSON file. `requests` holds one row per deduped API response: `atSec, session, model, speed, fidelity, reportedCostMicroUsd`, plus one column per `TokenKind`. `sessions` holds `id, tool, kind, project, title, humanTurns`, and there are dictionaries for `models` and `projects`. Size is about 2 MB for about 30k rows. It deliberately contains no cost, no local dates, and no aggregates. Pricing, timezone bucketing, and rules are policy, and policy is code the browser runs. So editing `prices.ts` and reloading re-prices the whole history without a rebuild. Tool and project live only on the session table and are joined onto rows at load (single source of truth, derive instead of sync).

**Disjoint token kinds.** `input, cacheWrite5m, cacheWrite1h, cacheRead, output, reasoning, unsplit` never overlap, so any sum of them is a true total. Adapters normalize at the boundary. Codex `input - cached_input` becomes `input`, `cached` becomes `cacheRead`, and `output - reasoning` becomes `output`. Codex total-only imports become `unsplit`, which is priced at the input rate and marked approximate. This is where per boundary-discipline and type-system-discipline apply: the vendor semantics die in the adapter.

**Fidelity is structural, not a label.** Every `Rollup.value(key, measure, basis)` is stored split by basis. Token measures take their basis from the row's `fidelity`. `costUsd` counts as measured only when the tokens are measured and the price is `published` or reported by Cursor's CSV. Otherwise it is estimated, and `unpricedTokens` is its own measure. No API returns one blended number without the caller choosing `'all'`. Renderers draw the estimated segment hatched, and rules state their `basis`. Per model-the-domain, fidelity is one row column plus a derivation, not flags threaded through the charts.

**Cube** (`web/cube.ts`) is the deep module. `loadCube` decodes columns into typed arrays: dim keys as `Uint32Array`, measures as `Float64Array` with cost precomputed per row via `resolvePrice` over the model dictionary (about 20 lookups). It also buckets `day` and `week` in the viewer's timezone. `select(filters)` computes one `FailMask` per row, where bit *d* is set if the row fails the filter on dim *d*. `without(dims)` just ignores those bits, which gives crossfilter semantics, where a chart ignores its own dims' filters, in one pass per chart with no indexes. At 30k rows × 7 charts that is well under 10 ms per interaction. Its public surface is `select / without / narrow / total / rollup / rollup2` plus label and session lookups. It hides encoding, bucketing, pricing, basis splitting, and key ordering: ordinal dims are dense ascending, and categorical dims are sorted by cost.

**Filters are the evidence language.** `Filters = Partial<Record<Dim, {keys} | {range}>>`. The same type drives chart clicks, the URL hash, and `Finding.evidence`. Following a finding is `intersect(current, finding.evidence)`, so the recommendation and the charts proving it are the same query.

**Rules** (`web/rules.ts`) are pure `(RuleContext) => Finding[]`, keyed in a `Record<RuleId, Rule>`, with every number in one `THRESHOLDS` table that the UI prints next to the observed value. They run on the current selection, so filtering to Cursor shows Cursor's findings. Only conversation sessions (`kind`) feed the session rules.

| Rule | Metric | Fires when | Evidence |
|---|---|---|---|
| lowCacheHit | per project: cacheRead / (input+cacheRead+cacheWrite5m+cacheWrite1h), measured | < 0.60 and input-side ≥ 2M tokens | project |
| cacheWriteNotReused | per project: (cacheWrite5m+cacheWrite1h) / cacheRead | ≥ 0.40 and writes ≥ 1M tokens | project |
| premiumModelShortSessions | count of conversation sessions with ≥ 80% cost on premium tier, ≤ 2 human turns, ≤ 15 requests | ≥ 10 sessions and ≥ $5 total | session set + model |
| runawaySession | session cost | ≥ max($25, 5 × median conversation-session cost) | session |
| contextBloat | session (input+cacheRead+cacheWrite) / requests | ≥ 150k with ≥ 30 requests | session |
| outputHeavySession | session (output+reasoning) / all tokens | ≥ 0.15 and output ≥ 150k | session |
| premiumShareRising | premium-tier cost share, last complete week minus mean of prior 3 | ≥ +15 points and last week ≥ $20 | week range, stackBy model |
| pricingGaps | unpriced tokens; placeholder-priced cost share | > 0; ≥ 10% | model |
| cursorEstimatesOnly | estimated share of Cursor requests | = 100% (no CSV imported) | tool=cursor |

**Compile** (`compile/`): `Source = { tool, harvest(env) }`, one per tool. Each source owns its own `FileMemo` keyed by path+size+mtime, so the actors never share a cache. Claude dedupes globally by `message.id`, because resumed sessions copy history into new files. Codex takes deltas of cumulative `total_token_usage`, so repeated `token_count` events are idempotent. Cursor estimates per assistant bubble (running context chars/4 as input, reply chars/4 as output, all `estimated`). CSV exports become measured `billingDay` sessions and supersede estimates on the days they cover. `encodeSnapshot` is pure. Writes go to a temp file and then a rename.

**Server** (`server.ts`) is dumb. It serves `web/` and `shared/` .ts files through `module.stripTypeScriptTypes` (checked on this Node 26.5: present, experimental), so the compiler and the browser share `snapshot.ts` and `prices.ts` with no build step. It also serves `/snapshot.json` and handles `POST /rebuild`. `createRebuilder` coalesces concurrent rebuilds onto one in-flight promise (per make-operations-idempotent). Tracing any flow touches at most three files: app → cube → snapshot, or bin → compile → source.

## Synthesis decision

pending

## Tradeoffs accepted

- We accept shipping about 2 MB of rows to the browser in exchange for zero-latency cross-filtering and no query API to design, version, or keep in sync with the charts.
- We accept that pricing and rules run in the browser (not testable from curl) in exchange for re-pricing without a rebuild. They stay pure .ts modules, so `node --test` covers them directly.
- We accept a full scan per chart per interaction instead of crossfilter-style sorted indexes. At 30k rows the scan is cheaper than index maintenance, and it keeps `cube.ts` small.
- We accept an experimental Node API (`stripTypeScriptTypes`) on the serve path in exchange for one language and shared types across compiler and browser.
- We accept that the rebuild is full, not incremental at the snapshot level. The per-file memo makes a warm rebuild cost JSON encoding plus Cursor's SQLite read.
- We accept that `unsplit` Codex tokens are priced at the input rate and flagged as estimated rather than dropped.

## Alternatives considered

- **Server-side SQLite (`node:sqlite`) with a query endpoint per chart.** Queries would be richer, but every chart becomes a SQL string plus an endpoint plus a wire type. Cross-filter semantics (exclude your own dim) would leak into every query, and each click would cost a round trip. It exposes more surface to hide the same complexity.
- **Pre-aggregated snapshot (daily × tool × model × project cubes).** The file would be smaller, but session-level rules (runaway, bloat, short premium sessions) need per-session sums. Adding a second aggregate for them is exactly the "add an index later" smell. Timezone and pricing would also be baked in at compile time.
- **Plain .js everywhere to avoid type stripping.** It avoids the experimental API, but the snapshot contract, the fidelity/basis types, and the rule and threshold records lose their compile-time checks. That is the invariant surface this design depends on most.

## Open questions and risks

- Are Cursor estimates worth plotting as tokens and dollars at all, or should the page show only request and message counts for Cursor until a CSV is imported?
- How should Cursor composers map to a project? `composerData` has no cwd. Is it worth joining `workspaceStorage` to get one, or is "(cursor, unknown project)" acceptable?
- Placeholder prices for gpt-5.6-sol, grok, and composer are invented. Who owns updating `PRICE_TABLE`, and should the UI let the user edit prices in place (they are already applied client-side)?
- `stripTypeScriptTypes` is experimental. If it changes, the fallback is one esbuild-free path: ship `web/` as .js and keep `.ts` for the compiler. Is that acceptable?
- Should subagent (`isSidechain`) traffic be its own dimension? It is currently folded into the parent session.

## Next implementation step

Write `encodeSnapshot` plus `loadCube`/`select`/`rollup` against a hand-built fixture of about 20 rows, and test them with `node --test`: crossfilter exclusion, the basis split, and the dedupe invariant. Everything else renders from that.
