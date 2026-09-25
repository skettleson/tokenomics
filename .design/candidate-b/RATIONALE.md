# Candidate B: SQLite warehouse

## Problem

We want one local page that shows token usage and cost for Claude Code, Codex, and Cursor, lets the user correlate trends across charts with one shared filter, and lists concrete recommendations tied to the evidence behind them. Four facts from `grounding.md` shape the design. Claude Code writes each API response as several lines that repeat one `message.id`, so naive totals are 2.3x too high. Codex splits "cached" inside "input" (OpenAI semantics) while Claude keeps them disjoint, and many Codex rollouts carry only `total_tokens`. Cursor stores no real per-request tokens locally, so its numbers are estimates unless the user imports the dashboard CSV. No prices exist on disk. A full Claude parse costs about 3 s, and Claude Code prunes old transcripts, so reparsing on each start both wastes time and silently loses history.

## Usage (caller's view)

The user's README:

```
node src/main.ts
open http://localhost:4317
```

On first start the ingest worker fills `~/.local/share/tokenomics/warehouse.sqlite`. Later starts read only bytes appended since the last run. To replace Cursor estimates with measured numbers, drop the dashboard usage CSV into `~/.local/share/tokenomics/imports/`. The next refresh swaps estimated days for measured ones.

The page's own call site. One request returns every chart, the session table, and the recommendations, all from one read snapshot:

```js
const filter = readFilterFromHash(location.hash);
const dash = await loadDashboard(filter);
dash.charts.forEach((chart) => renderChart(el(chart.id), chart, (x) => onChange({ ...filter, from: x, to: x })));
renderRecommendations(el('recommendations'), dash.recommendations, (rec) => onChange(showEvidence(filter, rec)));
```

A recommendation's evidence is a filter patch plus a focus chart. Clicking "show evidence" on "Cache hit rate in tokenomics is 41%" sets `projects=[7]`. Every chart and the session table re-query under that filter, and the page scrolls to `cache_hit_rate`. Correlation is the filter, not a bespoke drill-down view.

The maintainer's call site. Adding a recommendation is one registry entry with SQL over the scoped `f` (filtered facts) and `sess` (per-session rollup) relations:

```ts
{
  id: 'output_heavy_session',
  subjectKind: 'session',
  metric: { name: 'output share of session cost', unit: 'ratio', comparator: '>=', thresholdParam: 'min_output_share' },
  params: { min_output_share: 0.5, min_cost_usd: 2, min_output_tokens: 40_000 },
  requires: 'measured',
  sql: `SELECT session_key AS subject_id, ... FROM sess WHERE output_cost_share >= :min_output_share ...`,
  evidence: (r) => ({ patch: { sessions: [asSessionKey(r.subject_id)] }, focus: 'token_mix' }),
}
```

Adding a source is one adapter, either an append-log parser `(lines, carry) -> { batch, carry }` or a snapshot reader `path -> Batch`.

## Shape

**Data first.** The warehouse is a star schema in `src/warehouse/migrations/001-init.sql`.

- `request` is the fact table. Its primary key is a stable `source_id`: `claude_code:<message.id>` (fallback `requestId`), `codex:<session>:<cumulative total_tokens>`, `cursor:<composerId>:<bubbleId>`, `cursor_csv:<row hash>`. Claude's duplicate lines collapse through `INSERT ... ON CONFLICT(source_id) DO NOTHING`. Dedupe is a key constraint, not code, per model-the-domain.
- Tokens are stored as disjoint components (`input`, `cache_read`, `cache_write_5m`, `cache_write_1h`, `output`) plus `reasoning` as a subset of output. Parsers normalize OpenAI's overlapping "cached within input" at the boundary, per boundary-discipline. `CHECK` constraints enforce that the parts sum to `total_tokens` for measured and estimated rows, and that `total_only` rows carry no split. A parser bug fails the insert instead of skewing a chart. `verify-sql.ts` confirms the check fires.
- `fidelity` is a column on every fact with three values: `measured`, `total_only` (Codex imports), and `estimated` (Cursor local). In TS it is a discriminated union `TokenUsage`, so a parser cannot build an estimated row that looks measured.
- Dimensions are `session` (title rank so a custom title beats an AI title, parent key for subagents), `project` (canonical cwd), `model` (raw name to nullable `price_key`), and `price` (rates, tier, `downshift_key` naming the cheaper sibling).
- `source_file` is the ingest cursor per file. It stores adapter, parser version, presence, last error, and `cursor_json`, a discriminated union of `append_log {size, headHash, offset, carry}` or `snapshot {fingerprint}`.

**Views are the single source of truth for derived numbers.** The `fact` view joins dimensions and computes `cost_usd`, `output_cost_usd`, and `downshift_cost_usd` from `price`. Cost is never stored, so editing the price registry reprices all history on the next start with no reingest. The `measured_coverage` view lists (tool, day) pairs with imported CSV rows, and `fact` hides estimated rows on those days. Cursor estimates and the measured CSV never double count, and supersession is one SQL predicate.

**Ingest is idempotent and resumable,** per make-operations-idempotent. `planAppendLogRead` and `planSnapshotRead` are pure functions returning `skip | resume(offset, carry) | rebuild`. A rebuild triggers on shrink, changed head hash, or a parser-version bump. Each file commits in one transaction that writes facts and advances its cursor together. A crash rolls both back, and the rerun converges. Only complete lines are consumed, so a half-written trailing line is picked up next time. Parser state that spans lines (Codex's current model and cumulative total) rides in `carry`, and each adapter parses its stored carry at the boundary. A file that disappears from disk is marked `missing` and its facts stay. The warehouse outlives Claude's transcript pruning.

**One writer by structure,** per separate-before-serializing-shared-state. Ingest runs in a `worker_threads` Worker that owns the only read-write connection. The HTTP process opens the database read-only in WAL mode. Two writers are impossible, not merely avoided. Requests never block on a 3 s parse, and each dashboard call reads inside one transaction, so charts and recommendations always describe the same snapshot.

**Analytics are SQL in registries.** `CHARTS` and `RULES` are `as const satisfies` arrays, so `ChartId` and `RuleId` are derived union types. `createAnalytics(reader)` wraps every query as `WITH f AS (SELECT *, <bucket> AS bucket FROM fact WHERE <compiled filter>), sess AS (...) <body>`. Every chart returns long rows `{x, series, value, fidelity}`, so the page has one render path and cannot drop fidelity. Estimated and total-only marks render hatched. The bucket (hour, day, week) comes from the filtered range, so evidence for a single session zooms to hourly automatically. A rule declaring `requires: 'measured'` gets `fidelity = 'measured'` injected into its `f`, and its recommendation says `basis: 'measured'`. Thresholds live once, in `params`, and bind as named SQL parameters. The card shows the same number the SQL tested.

**Interface depth.** The public surface is three HTTP routes (`/api/meta`, `/api/dashboard?<filter>`, `POST /api/refresh`) and one TS interface, `Analytics { meta(); dashboard(filter, now) }`. Behind it sit filter compilation, bucketing, snapshot isolation, fidelity injection, repricing, supersession, median math, and ranking. Ingest exposes `refresh()` and `status()`. Storage rows, cursor JSON, and SQL never cross the HTTP boundary. Call chains stay short. The route goes to `analytics.ts`, which reads `charts.ts` or `rules.ts` into `warehouse.ts`.

**Recommendations shipped.** Each metric is computed over the filtered window.

| Rule | Subject | Metric | Fires when | Impact |
|---|---|---|---|---|
| `low_cache_hit_project` | project | cache_read / (input + cache_read + cache_write) | at most 0.70, with at least 5M context tokens | uncached input spend above cache-read rate |
| `cache_write_churn_project` | project | cache_write / cache_read | at least 0.20, with cache-write spend of at least $5 | cache-write spend |
| `flagship_short_sessions` | project | count of flagship sessions with at most 8 requests and 20k output | at least 5 sessions | cost minus downshift-tier cost (savings estimate) |
| `runaway_session` | session | session cost / project median session cost | at least 4x, cost at least $15, project has at least 5 sessions | session cost |
| `output_heavy_session` | session | output cost / session cost | at least 0.50, cost at least $2, output at least 40k | output spend |
| `context_bloat_session` | session | context tokens / requests | at least 150k mean, at least 30 requests | session cost |
| `flagship_share_rising` | global | flagship cost share, last complete ISO week minus the one before | at least +15 points, share at least 0.50, week cost at least $10 | downshift savings for that week |
| `unpriced_model` | model | tokens on a model with no price | at least 10k | none (data quality) |
| `cursor_estimates_only` | tool | days of Cursor usage with only estimated rows | at least 3 days | none (data quality) |

`verify-sql.ts` builds the schema in memory, seeds a few rows, and runs every chart and rule. All SQL parses and executes. On seeded data `low_cache_hit_project`, `flagship_short_sessions`, and `unpriced_model` fire with the expected metric values (measured).

**Deliberately not done.** No ORM, no query builder, no runtime npm dependencies (`node:sqlite`, `node:http`, `node:worker_threads`). No price data is invented. The registry validates at startup and refuses an entry with missing rates, so the unknown-model bucket surfaces instead of pricing at 0. No per-chart endpoints.

## Synthesis decision

pending

## Tradeoffs accepted

- We accept a persistent database that needs forward-only migrations in exchange for history that survives Claude's transcript pruning and a 3 s parse paid once. It is not a disposable cache.
- We accept SQL strings inside TS registries, checked only at runtime, in exchange for charts and rules that are declarative, reviewable in one place, and runnable in the `sqlite3` CLI. `verify-sql.ts` is the lever that executes every one.
- We accept repricing all history when a price changes (no effective dates) in exchange for cost being a pure view with no stored state to sync.
- We accept that `total_only` Codex rows are priced at the input rate and stay flagged as non-measured, in exchange for not hiding them. They are 14k tokens on this machine (measured from grounding).
- We accept one dashboard request that runs all nine rules and six charts (about 20 queries over roughly 30k rows, inferred to be well under 100 ms) in exchange for a consistent snapshot and a single loading state.
- We accept that the frontend fetches Observable Plot from jsdelivr in exchange for not hand-rolling stacked bars and axes.

## Alternatives considered

- **Parse into memory on start, compute in JS.** It has a smaller footprint and no schema. It loses history when transcripts are pruned. Every chart and rule becomes an ad hoc reduce over arrays, and filtering, grouping, and window math (medians, week-over-week lag) get reimplemented per metric. It exposes the same HTTP surface but hides less, because each new rule re-derives aggregation machinery.
- **Rules as stored SQL views (`CREATE VIEW rule_x`).** Views cannot take parameters, so the shared filter and thresholds could not bind. It would push the filter into temp tables per request, which is hidden mutable state.
- **Per-chart endpoints with a query builder.** It gives more HTTP surface and N requests that can each see a different snapshot mid-ingest. A builder DSL hides less than raw SQL at this scale and adds a layer to learn.

## Open questions and risks

- Do Claude subagent transcripts under `subagents/` reuse the parent `sessionId`, or carry their own with a parent pointer? The `session.parent_key` column assumes the latter can be derived. Where each subagent's cost rolls up depends on it.
- Should a project be the raw `cwd` or the nearest git root? A session started in a subdirectory currently becomes its own project.
- Cursor's `state.vscdb` mtime changes whenever Cursor runs, so its snapshot rebuilds on most refreshes. Is a full reread of 8,850 bubbles acceptable (guess, under 1 s), or should the fingerprint hash only `composerData` rows?
- How should Cursor bubbles be estimated? The sketch assumes output from text length / 4 and input from `contextTokensUsed`. Is a cruder "messages only, no tokens" treatment more honest?
- Cursor composers carry no workspace path in global storage. Is joining `workspaceStorage/*/state.vscdb` for project attribution worth a second snapshot source?
- The thresholds are guesses tuned for anomalies, not measured baselines. Should the first implementation step print each rule's metric distribution on this machine's data before fixing them?
- Who maintains price rates for models like `claude-opus-5-5` and `gpt-5.6-sol`? The registry carries `sourceUrl` and `asOf`, but staleness is not surfaced yet.

## Next implementation step

Implement `openWriter` with the migration runner and `commitFile`, then the Claude adapter, and prove it by ingesting `~/.claude/projects` and checking that `SELECT COUNT(*) FROM request WHERE tool = 'claude_code'` equals the 24,071 unique message ids measured in grounding.
