# Tokenomics verification map

This directory is the maintained source for verifying the user-facing behavior of the Tokenomics dashboard and CLI. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Start an isolated instance with `$S launch`, where `S=.cursor/skills/verify-tokenomics/scripts/control-tokenomics.ts`, run from the repo root.
- Require `$S doctor` to exit 0: server alive, port owned by the run, scratch `HOME`, snapshot parses, server code unchanged since launch.
- The data is the machine's real usage from Claude Code, Codex and Cursor. At least one source must report `ok` in `doctor`, or every chart is empty.
- Never drive the user's own instance on port 4317 or any server this run did not start.

## Driving conventions

- Start every recipe from `open` (no hash) unless its preconditions give a hash.
- Target controls by accessible name: `click:<name>`, scoped with `click:<cardId>/<name>` or `click:<Finding title>/<name>`. Use `drag` and `point` only for the chart hit layers, which have no per-item handle.
- Pick bar, row and finding names from a fresh `state:` capture (`pressedBars`, `findingCards`, `chips`), because the data changes as the user keeps working. Values quoted in these recipes are examples from one machine.
- Pass `--label <feature-id>` so evidence for each feature lands in its own folder.

## Proof and skip reporting

- Capture the user action and the resulting state. Every click, row, drag and point step auto-saves `NN-*.png` and `NN-*.state.json`.
- Assert on `state.json` fields (`hash`, `chips`, `kpis`, `recommendations`, `snapshotBuilt`), not only on the screenshot.
- Mutation proof (rebuild) includes a second, independent view: the `builtAt` value in `$TOKENOMICS_SNAPSHOT` on disk.
- CLI proof is the transcript `$S cli` writes: the command, exit code, stdout and stderr.
- Report an unreachable path together with the step that failed and the unmet precondition, for example "no finding with more than 5 subjects in this data".
- Don't report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with control-tokenomics`, `Gotchas`.

## Features

- [Crossfilter by clicking](./crossfilter.md) covers bar, row, dot, segment and legend clicks, filter chips, `Clear all` and hash deep links.
- [Date range](./date-range.md) covers the `All time`/`7 days`/`30 days`/`90 days` presets and the brush on `Cost per day`.
- [Recommendations](./recommendations.md) covers finding cards, `Show evidence`, grouped cards, `Show all evidence` and `Show N more`.
- [Chart views](./chart-views.md) covers `Stack by` and the per-card `Table`/`Chart` toggle.
- [Rebuild snapshot](./rebuild.md) covers the `Rebuild` button, `POST /rebuild`, and the `build` and `calibrate` CLI commands.
