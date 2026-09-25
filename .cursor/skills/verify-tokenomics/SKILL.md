---
name: verify-tokenomics
description: Launch and drive the Tokenomics usage dashboard (a local web UI served by `node bin/tokenomics.ts serve`, plus its `build`/`calibrate` CLI) in an isolated instance, click through it in headless Chrome, and capture screenshot + state evidence. Use when you need to prove a change to web/, server.ts, compile/ or shared/ works in the real app rather than only in `node --test`.
---

# Verify Tokenomics

Tokenomics compiles Claude Code, Codex and Cursor usage from the local machine into a snapshot and serves a single-page dashboard over it. The main surface is the **web dashboard** on `127.0.0.1`. The secondary surface is the **CLI** (`build`, `calibrate`). There is no auth, no database server and no seed step: the data is the machine's real usage history.

All of this goes through one zero-dependency helper, run from the repo root:

```sh
S=.cursor/skills/verify-tokenomics/scripts/control-tokenomics.ts
$S            # prints usage
```

It needs Node >= 26, the repo's own requirement, which runs `.ts` directly. It also needs Google Chrome at `/Applications/Google Chrome.app`; set `CHROME_PATH` to use another location.

## Isolation: read this first

- The user often has their own `tokenomics serve` on port **4317** with `HOME` pointing at their real home. **Never drive, restart or kill it.** Every command below targets only a run that `launch` created.
- The compiler writes `~/.tokenomics/memo.json` and `~/.tokenomics/snapshot.json` no matter which `--out` you pass, so pointing a second server at the real `HOME` would share that state. `launch` therefore starts the server with a **scratch `HOME`** at `.verify/runs/<run>/home`. That scratch home symlinks the real *read-only* sources (`~/.claude`, `~/.codex`, `~/Library/Application Support/Cursor`, `~/.tokenomics/imports` when present) and gets its own `.tokenomics/`. The compiler only reads the sources. Cursor's `state.vscdb` gets copied to a temp dir before it is opened.
- Every run picks a free port, so several runs can go side by side. When more than one is live, pass `--run <id>` or `export TOKENOMICS_VERIFY_RUN=<id>`.
- Side effect of the scratch HOME: project labels show as absolute paths (`/Users/<you>/code/x`) instead of `~/code/x`, because `normalizeProject` shortens paths against `HOME`. Don't report that as a bug.

## Launch

```sh
$S launch            # optional: --port N, --id NAME
```

The command does the following:
1. It creates `.verify/runs/<run>/` and links the scratch home.
2. It spawns `node bin/tokenomics.ts serve --port <free> --out <scratch>/.tokenomics/snapshot.json` detached, logging to `.verify/runs/<run>/server.log`.
3. It blocks until the log shows `tokenomics serving http://localhost:<port>` and then `snapshot refreshed …`, which means the post-start background rebuild has settled. With about 33K requests this takes roughly 6 s. The first build on a machine with a large history can take minutes, and the timeout is 5 min.
4. Its last lines are `ready: <url>`, `evidence: <dir>` and `export TOKENOMICS_VERIFY_RUN=<run>`.

The run is ready once `ready:` prints. If the log shows `background rebuild failed`, launch exits 1 and prints the log.

Teardown is `$S cleanup` (see Cleanup).

## Doctor

Run this before driving and whenever something looks off. It is read-only.

```sh
$S doctor            # exit 0 = worth driving
```

It checks the following: the server pid is alive; the port's listener is that pid (so you are not about to talk to someone else's server); `HOME` is the scratch dir; `GET /` returns the page titled `Tokenomics`; `/snapshot.json` parses (it prints `builtAt`, the request count and each source's status); and the server-side code (`bin/ compile/ shared/ server.ts package.json`) still matches the fingerprint taken at launch. `web/*.ts` and `web/index.html` are read from disk on every request, so web edits are live after a page reload. Edits to `server.ts`, `compile/`, `bin/` or `shared/` need a fresh `cleanup` and `launch`.

`$S env` prints `TOKENOMICS_URL`, `TOKENOMICS_HOME`, `TOKENOMICS_SNAPSHOT` and `TOKENOMICS_EVIDENCE` for curl and file checks.

## Drive

### Browser

```sh
$S browser --label <feature-id> <step> [<step> ...]
```

Each invocation starts a fresh headless Chrome with a throwaway profile, runs the steps in order in one tab and then closes Chrome. Clicks are real CDP mouse events at the element's center after it is scrolled into view, so they go through the same pointer and click handlers a user triggers. Page state lives in the URL hash, so a later invocation can resume from a state with `open:#<hash>`.

| Step | What it does |
|---|---|
| `open` / `open:#<hash>` | Load the dashboard, optionally at a deep-linked hash, and wait for the `h1` to render and any `Rebuilding…` to clear |
| `click:<name>` | Click the first `button` or `[role=button]` whose `aria-label`, SVG `.row-label` or trimmed text equals `<name>`. A trailing `  ×` is ignored, and truncated `…` bar labels match by prefix |
| `click:<cardId>/<name>` | Same as `click:<name>`, scoped to `#chart-<cardId>` |
| `click:<Finding title>/<name>` | Same, scoped to the recommendation card whose title is `<Finding title>` |
| `row:<cardId>/<first cell text>` or `row:<cardId>/#<n>` | Click a table row, for example `row:topSessions/#1` |
| `drag:<cardId>/<from>-<to>` | Press, move and release across the card's `.hit-layer` at x fractions 0 to 1, which is the brush on `dailyCost` |
| `point:<cardId>/<x>,<y>` | Click at fractions of the card's `.hit-layer`, which selects a segment or column |
| `wait-text:<t>` / `wait-gone:<t>` | Wait up to 5 min for the text to appear or disappear |
| `state:<name>` / `shot:<name>` | Capture the current screenshot and state |
| `eval:<js>` | Print a JS expression's value. Use it for reading only; never use it to change the app |

Every `click`, `row`, `drag` and `point` step **automatically captures** `NN-<step>.png` (full page) and `NN-<step>.state.json` afterwards, so each action is paired with its resulting state. If a step fails, the run captures `NN-failure.*`, prints `FAILED: …` and exits 1.

Card ids (the `#chart-<id>` sections) are `kpis`, `dailyCost`, `tokenMix`, `cacheHitByWeek`, `costByProject`, `costByModel`, `sessionScatter`, `topSessions` and `sources`. The Recommendations card is `section.findings`, which sits right after `kpis`.

Stable toolbar names:
- The `Date range` group contains `All time`, `7 days`, `30 days` and `90 days`.
- The `Stack by` group contains `tool`, `model` and `project`.
- Each filter chip is named `Remove filter <dim>: <value>` for key filters or `Remove filter <dim> <from> → <to>` for ranges.
- `Clear all` removes every filter chip.

The `.state.json` capture records `hash`, `dateRange`, `stackBy`, `chips`, `kpis[]`, `recommendations` (the summary line), `findingCards[]`, `pressedBars[]`, `selectedSessions[]`, `tablesShown[]`, `sources[]`, `snapshotBuilt` and `status` (a non-null `status` means an error page).

Example:

```sh
$S browser --label crossfilter open "click:costByModel/claude-opus-4-8" "click:Remove filter model: claude-opus-4-8"
```

### CLI

```sh
$S cli --label <feature-id> -- build
$S cli --label <feature-id> -- calibrate
```

This runs `node bin/tokenomics.ts <args>` with the run's scratch `HOME`, so `build` writes the scratch snapshot rather than the user's. It saves `$ command`, the exit code, stdout and stderr to a transcript under the evidence dir and exits with the command's own code.

### HTTP

`GET /`, `GET /snapshot.json`, `GET /web/*.ts` and `/shared/*.ts` (type-stripped), and `POST /rebuild` (returns `{"builtAt": …}`). Use `curl` against `TOKENOMICS_URL` from `$S env`. Prefer the browser's `Rebuild` button when you are proving the user path.

## Evidence

Evidence goes to `.verify/evidence/<run>/<label>/`, which is gitignored and **survives cleanup**. It holds `transcript.log` (every step with timestamps), paired `NN-*.png` and `NN-*.state.json` files, and CLI transcripts.

Proof standards:
- Drive the real user path: toolbar buttons, chart bars, rows and brushes, chips, and the `Rebuild` button. Don't set `location.hash` from `eval` or call `dispatch` to fake a state. `open:#<hash>` is fine as a *precondition*, and it counts as a proof only of the deep-link feature itself.
- Capture the action and the resulting state. Auto-capture handles this for clicks. Add `state:before` when the starting state matters.
- Assert on `.state.json` fields (`hash`, `chips`, `kpis`, `recommendations`) in addition to looking at the PNG.
- Verify side effects on disk. For a rebuild, compare `builtAt` in `$TOKENOMICS_SNAPSHOT` before and after, and check that the footer's `Snapshot built …` changed with it.
- Numbers are the user's real usage and change as they keep working, so assert on relationships (a filter chip appears, the totals shrink, the hash contains `model=…`) rather than exact dollar figures.
- Nothing in this app talks to the network, and there is no dry-run mode.

## Cleanup

```sh
$S cleanup           # the current run (or --run ID)
$S cleanup --all     # every run under .verify/runs
```

Cleanup stops only the pids the run recorded: the server's process group and any Chrome left behind by a crashed `browser`. It then deletes `.verify/runs/<run>/` (the scratch HOME and Chrome profiles) and prints how many evidence files it kept in `.verify/evidence/<run>/`. It never kills by process name and never touches port 4317. Also run cleanup after a failed attempt so no ports are stranded. Delete old evidence by hand with `rm -rf .verify/evidence/<run>` once nobody needs it.

## Feature map

`features/README.md` indexes one recipe per user-facing feature. A proof of a feature covers every entry point its file lists, or says which ones it skipped.
