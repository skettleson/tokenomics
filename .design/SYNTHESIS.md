# Synthesis decision (the implementation contract)

Inputs: grounding.md, candidate-a (in-memory event log), candidate-b (SQLite warehouse), candidate-c (browser cube over a facts-only snapshot).

## Base: candidate C

A and C were given opposite directions (server-side event log vs. browser analytics) and independently converged on the same core: parse once into a deduped per-request fact set, ship it columnar to the browser, run all aggregation and rules there as pure `.ts` modules served through `module.stripTypeScriptTypes`, charts and rules as registries, filters as the evidence language. Arena treats that convergence as the agreement signal. C is the base over A because its snapshot holds facts only (price and timezone are policy applied at load, so a price edit needs no rebuild) and its fail-mask crossfilter (a chart ignores the filter bits of its own dimensions) is the exact mechanic that makes "correlate trends across charts" work.

B lost on interface depth for this workload. At ~30k rows every chart becomes SQL + filter compilation + a round trip, the crossfilter exclude-own-dimension semantics would leak into every query, and it needs a worker thread, migrations and ingest cursors. Its one decisive advantage (history survives transcript pruning) is grafted below at a fraction of the cost.

Cross-judge skipped: all runners share the parent model per pstack-models.mdc, and two of three converged, which is the stronger signal.

## Grafts

- From B: **retention.** The per-file memo keeps the parsed rows of files that vanished from disk (flag `retained` in SourceReport counts). Claude Code prunes transcripts; the tracker must not lose history when it does.
- From B: **token-sum invariant as a test.** Every parsed row satisfies disjoint kinds; a test asserts parsers never emit negative kinds and that Codex `input - cached` and `output - reasoning` never go below zero.
- From B: **downshift map** in the price table (`downshift: 'claude-sonnet-5'` on premium entries) so premium-model recommendations quote a concrete savings figure.
- From B: **threshold calibration.** Before thresholds are fixed, print each rule's metric distribution on this machine's real data (`node bin/tokenomics.ts calibrate`) and set thresholds so rules fire on genuine outliers, not on everything or nothing.
- From A: **three-level token fidelity** `measured | total-only | estimated` (C had two). Codex imports are total-only, Cursor local is estimated.
- From A: **agent dimension** `main | subagent` (Claude `isSidechain` or path under `subagents/`), and **tier** dimension `premium | standard | small | unknown` derived from the price table at load.
- From A: **project normalization.** `$HOME` → `~`, and `<repo>/.claude/worktrees/<name>` collapses to `<repo>`.
- From A: rules `fastModePremium` and `cacheExpiryRewrites` (the latter needs per-session row order, which the cube has via `atSec`).
- From A: headline numbers get a leading `≈` when any estimated part contributes.

Rejected: A's server-side pricing (C prices at load, no rebuild on price edits). B's Observable Plot CDN dependency (hatched estimate segments and click-to-filter on every mark are easier in owned SVG). B's hourly bucket auto-zoom (nice, not needed for done).

## File tree

```
package.json                 {"type":"module","scripts":{"start":"node bin/tokenomics.ts serve","test":"node --test"}}
bin/tokenomics.ts            serve [--port 4317] | build [--out f] | calibrate
shared/snapshot.ts           TOOLS, TOKEN_KINDS, FIDELITIES, SnapshotV1, parseSnapshot
shared/prices.ts             PRICE_TABLE (source: 'list' | 'placeholder', tier, downshift, fastMultiplier), resolvePrice(modelName), priceRow
compile/compile.ts           createCompiler({home, importsDir, memoPath}), per-file memo keyed path+size+mtime+parserVersion, retention, global dedupe, CSV supersession, project normalization, encodeSnapshot, atomic write
compile/sources/claude.ts    dedupe key message.id ?? requestId, skip <synthetic>, speed, agent, titles from ai-title/custom-title, humanTurns = user lines that are not tool_result
compile/sources/codex.ts     session_meta + turn_context model; token_count deltas of cumulative total; normalize to disjoint kinds; total-only when split is all zero
compile/sources/cursor.ts    read-only sqlite; composer = session; assistant bubble = estimated request (reply chars/4 output; running context chars/4 input); nonzero tokenCount = measured; model from composer modelConfig
compile/sources/cursor-csv.ts  ~/.tokenomics/imports/cursor/*.csv; measured rows with reported cost; billingDay sessions; supersede Cursor estimates on covered days
server.ts                    static web/ + shared/ with type stripping, GET /snapshot.json, POST /rebuild (coalesced)
web/index.html               layout, CSS tokens, light+dark
web/app.ts                   state (filters in URL hash), render loop, dispatch
web/cube.ts                  loadCube, select/without/narrow/total/rollup/rollup2, fail-mask crossfilter, basis split
web/charts.ts                SVG primitives + CHARTS registry
web/rules.ts                 THRESHOLDS, RULES registry, evaluateRules
test/*.test.ts               literal fixtures per source, cube crossfilter, each rule fires/does not fire
```

Candidate C's sketch files in `.design/candidate-c/` are the starting signatures. Deviations from them are allowed when implementation proves them wrong; list each deviation in the final report.

## Charts (done criteria)

KPI row (cost, tokens, cache hit rate, sessions, cost per session; `≈` when estimates contribute). Daily cost stacked by a toggle of tool/model/project, with brushing to set a day range. Token mix (disjoint kinds) over time. Cost by project and cost by model (bars, click toggles a filter). Weekly cache hit rate per tool (line). Sessions scatter (requests vs cost, color by tier, click selects the session). Top sessions table. Every chart participates in crossfilter. Estimated segments are hatched. A sources panel shows per-tool status, fidelity, and retained counts.

## Recommendations (done criteria)

lowCacheHit, cacheWriteChurn, premiumShortSessions (savings via downshift), runawaySession, contextBloat, outputHeavySession, premiumShareRising, fastModePremium, cacheExpiryRewrites, pricingGaps, cursorEstimatesOnly. Each finding shows metric, observed value, comparator, threshold, impact in USD where computable, and basis. Its "Show evidence" button applies its evidence filters to every chart. Thresholds live in one THRESHOLDS table, calibrated against real data.
