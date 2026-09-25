# Candidate A. In-memory event log

## Problem

Three tools write usage data in three incompatible shapes, with three levels of trust. Claude Code writes exact per-response usage, but repeats each response once per content block, so naive totals are inflated about 2.3x. Codex writes per-turn `token_count` events, and on this machine most carry only `total_tokens`. Cursor stores no real token counts locally, so anything derived from its SQLite database is an estimate. No prices exist on disk. The user wants every chart and every recommendation to respond to one shared filter, so that "Opus share rose" can be traced to "these three projects, these sessions". The shape is non-obvious because fidelity (measured, total-only, estimated) and price provenance (list, placeholder, reported, unpriced) must survive every aggregation. They must not be averaged away. The scale is about 30k deduplicated responses and about 950 MB of source files, parsed in about 3 s cold.

## Usage (caller's view)

README.

```
node src/server.ts            # http://127.0.0.1:4747
```

On start the server scans `~/.claude/projects`, `~/.codex/sessions`, Cursor's `state.vscdb`, and any Cursor dashboard CSVs dropped into `~/.tokenomics/imports/cursor/`. Only files whose size or mtime changed are reparsed. The page loads the whole event log once. Every filter, chart, and recommendation then runs in the browser with no further requests. A "Rescan" button picks up new sessions. Prices live in `prices.json`. Entries marked `placeholder` are flagged wherever they affect a number.

Call site 1 is the server shell.

```ts
const holder = createLogHolder({ port: 4747, home: os.homedir(), cacheFile, pricesFile })
const log = await holder.current()
res.end(gzip(JSON.stringify(encodeLog(log))))
```

Call site 2 is the browser render loop.

```ts
const log = decodeLog(await (await fetch('/api/log')).json())
const view = select(log, filter)
for (const chart of CHARTS) draw(chart, chart.kind === 'sessions-table' ? summarizeSessions(view) : rollup(view, chart.query), patch => dispatch({ kind: 'patch-filter', patch }))
const findings = recommend(view, now)
```

Clicking a finding dispatches `{ kind: 'focus-finding', finding }`. The reducer applies `finding.evidence` as a filter patch and highlights `finding.charts`. Every chart then shows the evidence.

Call site 3 is a rule test against a literal fixture.

```ts
const log = assembleLog([fixtureUnit], prices, '/home/u', at(0))
assert.deepEqual(recommend(log, at(0)).map(f => f.rule), ['runaway-session'])
```

## Shape

**Data first.** The whole system is one type, `UsageEvent`, one per model response. It lives in an immutable `EventLog` with a session title map, the price table, and parse warnings (`src/domain.ts`). Everything else is either a producer of `EventLog` (`src/log/`) or a pure function of `(EventLog, Filter)` (`src/analysis/`).

**Fidelity is two orthogonal fields, never a boolean.** `fidelity: 'measured' | 'total-only' | 'estimated'` describes the tokens. `cost.source: 'list' | 'placeholder' | 'reported' | 'unpriced'` describes the price. "Is this cost exact?" is derived once in `costExact` (measured tokens with list or reported price). It is never stored, per the single-source-of-truth rule. Codex totals with no split land in the `unsplit` token kind. They are never faked into `input`, so the token-mix chart shows them as their own band.

**Aggregation cannot drop fidelity.** `Totals` keeps `exactTokens`/`estimatedTokens` and `exactUsd`/`estimatedUsd` apart. Every sum measure returns a `Split { exact, estimated }`. The SVG layer draws the estimated part hatched, and headline numbers gain a leading `≈` when `estimated > 0`. Ratio measures (cache hit rate, output cost share) read only exact tokens and return `null` when there is no exact base. A cache hit rate computed from Cursor guesses would be fiction. This is encoded in the `Measure` union's `kind`, per type-system-discipline.

**Parsing is one registry of sources, each owning one format's knowledge** (`SOURCES` in `src/log/build.ts`), per model-the-domain. A `Source` is `discover(home) → units` plus `parse(unit) → ParsedUnit`. The cache and the merge never branch on tool. Each source owns its gotchas.
- `claude.ts` keys events `claude:<message.id>`, falling back to `requestId`. It skips `<synthetic>`, treats `usage.speed === 'fast'` as `speed: 'fast'`, and marks `subagents/` files and `isSidechain` as `agent: 'subagent'`. It pre-checks the substring `"type":"assistant"` before `JSON.parse` to stay near the measured 3 s.
- `codex.ts` is a line-stepper (`stepCodexLine`) that emits an event only when cumulative `total_token_usage.total_tokens` increases. That dedupes Codex's repeated `token_count` lines. The event key is `codex:<session>:<cumulative>`. It normalizes `input` to uncached (`input - cached_input_tokens`) so all tools share Anthropic semantics. All-zero splits with a nonzero total become `total-only`. Titles come from `session_index.jsonl`. `state_5.sqlite` is not read, because rollouts already carry the totals.
- `cursor.ts` produces one event per assistant bubble, `fidelity: 'estimated'`. Output is estimated as `ceil(textLength / 4)` and input as the running conversation length divided by 4. The rare nonzero `tokenCount` bubble becomes `measured`. The unit stamp folds in the `-wal` file's size and mtime, since the WAL changes when the main file does not.
- `cursor-csv.ts` turns dashboard exports into `measured` events with `reportedUsd`, which `priceTokens` prefers over computed cost.

**Build is idempotent and order-independent** (`buildLog`), per make-operations-idempotent. For every discovered unit it reuses the cache entry when `stamp` (size:mtime) and `parserVersion` match, and parses otherwise. Then `dedupeByKey` runs globally, earliest timestamp winning, so a resumed Claude session copied into a second file never double-counts regardless of scan order. Next `supersedeEstimatesWithMeasured` drops estimated Cursor events on days that a CSV covers with measured rows. The build then normalizes `cwd` to `ProjectKey` (home becomes `~`, and `.claude/worktrees/<x>` collapses to the repo root), resolves models by longest prefix in the price table, and prices each event. The cache is rewritten atomically (tmp plus rename) with only present units, so deleted files leave the cache on the next run. The cache stores `SourceEvent`s before pricing and project normalization. Editing `prices.json` or the project rule costs a warm rebuild, not a reparse.

**Ship events, not cubes.** `/api/log` returns the whole log, columnar and dictionary-encoded (`src/wire.ts`), gzip'd, with `ETag = log.version`. I estimate (guess, not measured) about 30k events × 12 numeric columns, which comes to roughly 2 MB of JSON and 300 to 500 KB gzipped. The browser keeps them as plain `UsageEvent` objects. I chose events over cubes for four reasons.
1. Cross-filtering on any dimension combination needs every dimension crossed with every other. A cube that supports filtering by session while grouping by week by model is the event log with extra steps.
2. Session-level rules (runaway, context bloat, cache rewrites after idle gaps) need per-event order within a session. No additive cube preserves that.
3. Day and week buckets must use the viewer's local timezone. Bucketing in the browser gets that for free.
4. A filter change costs zero round trips. Scanning 30k rows for seven charts and ten rules is a few milliseconds (inferred from row count, not measured).

The wire format is private to `wire.ts`. `decodeLog` is a boundary parse into domain types, so no caller sees columns or dictionaries, per boundary-discipline.

**One analysis module, two runtimes.** `src/analysis/*.ts` and `src/domain.ts` import nothing from Node. The server serves them to the browser through `stripTypeScriptTypes` from `node:module` (verified present in Node v26.5.0 and working on these files). The rules that run in tests are byte-for-byte the rules the page runs. No bundler and no build step are needed, and there are zero npm dependencies. Charts are hand-rolled SVG in `src/web/svg.ts`, with four primitives (stacked bars, bars, share, sessions table). The deciding needs are hatched estimated segments and click-to-filter on every mark, which a CDN chart library would fight.

**Charts are a registry** (`CHARTS`). Each is a `Query` plus a render kind. Clicking a mark calls `patchForPick(query, xKey, seriesKey)`, which is derived from the query. A time bucket becomes a `from`/`to` patch and a dimension key becomes that dimension's list. No chart hand-writes its click handler. The filter lives in the URL hash, so a correlated view can be bookmarked.

**Recommendations are a registry of pure rules** (`RULES`), with every number in one `THRESHOLDS` table. Each `Finding` carries its metric, value, and threshold, and `evidence: FilterPatch`. The patch makes the evidence reproducible across every chart. It is not a static screenshot. Findings also carry `basis: 'includes-estimates'` when any input was not exact. Rules run on the filtered view, so narrowing to one project re-evaluates everything for that project. The rules I would ship are listed below. "Input side" means `input + cacheWrite5m + cacheWrite1h + cacheRead`.

| Rule | Metric | Fires when | Evidence patch |
|---|---|---|---|
| low-cache-hit-project | per project, `cacheRead / inputSide` on exact tokens | < 0.70, with ≥ 5M input-side tokens and ≥ 50 events. Savings estimate is the input-side tokens moved from 0.70 to 0.90, priced at input minus cacheRead | `projects: [p]` |
| cache-expiry-rewrites | per session, events whose gap from the previous event exceeds 5 min and that write ≥ 50k cache tokens | summed rewrite cost ≥ $5 in view | `sessions: [...]` |
| frontier-model-short-sessions | sessions with frontier tier, ≤ 8 responses, ≤ 300k total tokens | ≥ 10 such sessions costing ≥ $5. Savings = cost minus `repriceAs('claude-sonnet-5')` | `tiers: ['frontier'], sessions: [...]` |
| runaway-session | session cost | ≥ max($25, 3 × p90 session cost in view), or ≥ 400 responses | `sessions: [s]` |
| context-bloat | per session, median input-side tokens per response | ≥ 150k over ≥ 40 responses. Savings = tokens above 60k at cacheRead price | `sessions: [s]` |
| output-heavy-session | per session, output cost / session cost | ≥ 0.5, with session cost ≥ $3 | `sessions: [s]` |
| frontier-share-rising | weekly frontier-tier cost share | last complete week minus the mean of the prior 3 weeks ≥ 15 pp, with last week ≥ $20 | `from/to: last 4 weeks, tiers: ['frontier']` |
| fast-mode-premium | fast-speed cost / total cost | ≥ 0.15, with fast cost ≥ $10. Savings = fast cost / 2 | `speeds: ['fast']` |
| unpriced-or-placeholder-cost | any `unpriced` event, or placeholder-priced cost share | any unpriced event, or share > 0.10 | `models: [...]` |
| cursor-estimates-only | estimated Cursor events in view | ≥ 1. Action is to export the dashboard CSV into `~/.tokenomics/imports/cursor/` | `tools: ['cursor']` |

Interface depth. The public surface is `buildLog`, `encodeLog`/`decodeLog`, `select`, `rollup`, `summarizeSessions`, `recommend`, plus the two registries. It hides four parsers, deduplication, estimate supersession, model resolution, pricing, caching, bucketing, and fidelity accounting. A new chart is one registry row. A new rule is one function and one threshold entry. A new source is one `Source` object. The longest trace is three files (`app.ts`, `charts.ts`, `rollup.ts`, or `server.ts`, `build.ts`, `sources/x.ts`), per laziness-protocol.

The design deliberately does not do these things. It has no database. It keeps no prompt or response text (the log holds counts only, so the page never exposes conversation content). It does not watch files live, since the Rescan button is enough. It does not rebucket on the server. It does not store derived exactness.

## Synthesis decision

pending

## Tradeoffs accepted

- We accept shipping about 2 MB of JSON (about 400 KB gzipped, a guess) on every page load, in exchange for zero-latency cross-filtering and rules that see per-event order.
- We accept holding the whole log in memory twice (server and browser), in exchange for having no query layer at all. At 30k events this is tens of MB (inferred).
- We accept a dependency on `stripTypeScriptTypes`, which Node still labels experimental, in exchange for one shared, typed analysis module with no build step. If it breaks, the fallback is writing `src/analysis` as plain `.js`.
- We accept hand-rolled SVG (four primitives, a few hundred lines) in exchange for hatched estimates and uniform click-to-filter, which a CDN chart library would make awkward.
- We accept that CSV-superseded Cursor days lose project and session attribution. The CSV has neither, and correct totals beat attributed guesses.
- We accept coarse Cursor estimates (chars / 4), labelled everywhere, in exchange for showing Cursor activity at all before a CSV exists.
- We accept that a price edit needs a Rescan (warm, no reparse), in exchange for cost being computed once, on the server, in one place.

## Alternatives considered

- **Server-side pre-aggregated cubes (day × tool × model × project).** This is a smaller payload. But it exposes a query API whose shape leaks to every chart, it cannot answer session-order rules, it forces a round trip per filter change, and it buckets in the server's timezone. It hides less and exposes more.
- **SQLite via `node:sqlite` as the store, with SQL per chart.** Indexed queries are strong for large data. But at 30k rows it adds a schema, migrations, and a second representation of every invariant (fidelity in SQL and in TS). That is information leakage for no speed win.
- **Parse on every request.** This has no cache and no staleness. The measured 3 s cold parse makes every reload slow, and the per-file cache is cheap to make idempotent.

## Open questions and risks

- Is `chars / 4` an acceptable Cursor estimate, or would you rather show Cursor as message counts only (no tokens, no cost) until a CSV arrives?
- How should Cursor composers map to projects? `composerData` has no `cwd`. The likely source is `workspaceStorage/<hash>/workspace.json`, which is unverified. Until then Cursor lands in project `~unknown`.
- Should CSV supersession use UTC days (the CSV's likely convention) or local days? The grounding does not say which timezone the export uses.
- Are the placeholder prices for `gpt-5.6-sol`, `grok`, and `composer` acceptable as flagged defaults, or should those models stay `unpriced` until you enter numbers?
- Do Claude `message.id`s really repeat across files for resumed sessions? The global dedupe handles it either way, but "earliest timestamp wins" assumes copies carry identical usage.
- Should reasoning tokens (Codex `reasoning_output_tokens`, Claude thinking) get their own band? They are a subset of output today and are not separated, to avoid double counting.
- The payload size and the browser scan time are estimates. Measure both on the real log before committing to client-side evaluation.

## Next implementation step

Implement `claudeSource.parse` plus `assembleLog`, then assert against the grounding's measured numbers (24,071 unique message ids from 55,589 assistant lines) before building anything else.
