# Tokenomics

Tokenomics shows what your AI coding tools cost. It reads the local session logs of Claude Code, Codex and Cursor, prices every request, and serves a dashboard with charts, filters and recommendations on where the money goes.

Everything runs on your machine. The server listens on `127.0.0.1` only, and no data leaves your computer.

## Requirements

- Node.js 26 or newer. Tokenomics runs its TypeScript directly on Node and uses the built-in `node:sqlite`, so there is nothing to install or build.
- macOS, if you want Cursor data. The Cursor source reads Cursor's macOS state database. Claude Code and Codex work on any platform.

## Setup

```sh
git clone https://github.com/skettleson/tokenomics.git
cd tokenomics
npm start
```

Open http://localhost:4317.

The first start compiles a snapshot before serving, which can take a few seconds. Later starts serve the existing snapshot right away and refresh it in the background.

## Data sources

Tokenomics looks in these places. A tool you don't use is reported as missing and skipped.

| Tool | Location | Accuracy |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/**/*.jsonl` | Measured token counts |
| Codex | `~/.codex/sessions/**/*.jsonl` | Measured token counts |
| Cursor | `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` | Estimated from message sizes |
| Cursor usage export | `~/.tokenomics/imports/cursor/*.csv` | Measured token counts |

Cursor's local database does not record exact token counts, so Tokenomics estimates them. The dashboard marks estimated figures with `≈`. For exact Cursor numbers, export your usage CSV from the Cursor dashboard and drop it into `~/.tokenomics/imports/cursor/`. On any day the CSV covers, its measured rows replace the estimates.

Tokenomics opens the Cursor database from a private copy and never writes to it.

## Using the dashboard

- **Charts.** Cost per day, token mix, cache hit rate, cost by project and by model, sessions, and the most expensive sessions.
- **Filters.** Click a bar, a segment or a session to filter every other chart. Drag across the daily cost chart to select a date range. Active filters appear as chips at the top, and **Clear all** removes them. The filters live in the URL, so a bookmark reopens the same view.
- **Findings.** Rules flag patterns that waste money, such as a low prompt-cache hit rate, premium models on short sessions, runaway sessions, or context kept near the limit. Each finding shows the metric, the threshold it crossed, and the estimated impact in dollars. Repeated findings group into one card per rule. **Show evidence** filters the charts to the sessions or models behind a finding.
- **Sources.** The Sources card lists what each tool contributed, how exact it is, and any files that failed to parse. Its **Rebuild** button re-reads your logs without restarting the server.

## Commands

```sh
npm start                          # serve the dashboard on port 4317
npm start -- --port 8080           # serve on another port
npm run build                      # compile the snapshot without serving
npm run build -- --out snap.json   # compile to another file
npm run calibrate                  # print rule metric distributions and findings
npm test                           # run the test suite
```

`--out` also works with `serve` to point the dashboard at a different snapshot file. `calibrate` takes `--snapshot <file>`.

`calibrate` prints the p50, p90, p99 and max of every rule's metric across your data, the current thresholds, and every finding they produce. Use it to judge whether a threshold in `web/rules.ts` fits your usage before changing it.

## Where Tokenomics keeps its files

Everything lives in `~/.tokenomics/`.

- `snapshot.json` is the compiled data the dashboard loads.
- `memo.json` caches parsed log files so rebuilds only re-read files that changed.
- `imports/cursor/` holds Cursor usage CSVs you add.

Tokenomics keeps requests from log files that later disappear, so history survives when a tool prunes its own logs. Deleting `~/.tokenomics/` resets everything, including that retained history.

## Pricing

Prices live in `shared/prices.ts`. Models with published list prices are priced exactly. A few models, such as Cursor's Composer and Grok, use placeholder prices, and the dashboard raises a finding when placeholder prices carry a large share of your cost. A model with no price at all is counted in tokens but not in dollars, and is flagged too. Add or correct an entry in `shared/prices.ts` and rebuild to fix either case.
