# Rebuild snapshot

The dashboard reads a snapshot compiled from the local Claude Code, Codex and Cursor logs. The `Rebuild` button in the Sources card recompiles it in place and reloads the page data. The CLI `build` does the same offline, and `calibrate` prints each rule's distribution and fired findings. The Sources table reports per-source status, file counts and fidelity.

## Sub-features

- `rb-button` triggers a server-side rebuild from the `Rebuild` button: `Rebuilding…` appears, the snapshot file is rewritten and the footer time updates.
- `rb-http` rebuilds through `POST /rebuild`, which returns `{"builtAt": …}`.
- `rb-sources` shows each source as `ok`, `not found` or `failed`, with request and session counts.
- `rb-cli-build` runs `tokenomics build`, which writes the snapshot and prints request and session counts.
- `rb-cli-calibrate` runs `tokenomics calibrate`, which prints the rule distribution table, `THRESHOLDS` and `N findings`.

## How to get to it (user POV)

- Scroll to the `Sources` card at the bottom and click `Rebuild`.
- Run `curl -X POST $TOKENOMICS_URL/rebuild`.
- Run `node bin/tokenomics.ts build` or `node bin/tokenomics.ts calibrate` in a terminal.

## Driving it with control-tokenomics

Preconditions:

- `$S doctor` exits 0. Record the snapshot's `builtAt` value with `grep -o '"builtAt":"[^"]*"' <TOKENOMICS_SNAPSHOT from $S env>`.

- **Button.** Run `$S browser --label rebuild open state:before "click:sources/Rebuild" "wait-gone:Rebuilding…" state:after`. `snapshotBuilt` in `after` is later than in `before`. Running the same `grep` again shows a new `builtAt` on disk.
- **Sources table.** In `state:after`, `sources` has one line per source (`claude-code`, `codex`, `cursor`, `cursor-csv`), each with a status.
- **HTTP.** Run `curl -s -X POST <TOKENOMICS_URL>rebuild`. It returns `{"builtAt":"…"}`, and the value matches the file.
- **CLI build.** Run `$S cli --label rebuild -- build --out <TOKENOMICS_SNAPSHOT>`. The exit code is 0, stdout contains `wrote … requests, … sessions in … ms`, and the file's `builtAt` changes.
- **CLI calibrate.** Run `$S cli --label rebuild -- calibrate --snapshot <TOKENOMICS_SNAPSHOT>`. The exit code is 0, and stdout contains `THRESHOLDS` and `N findings`, where N equals the total in the dashboard's all-time `recommendations` line.
- **Proof.** Keep the before and after state files, the PNG of the footer, the `builtAt` values before and after, and the CLI transcripts.

## Gotchas

- `build` without `--out` writes `<HOME>/.tokenomics/snapshot.json`. Under `$S cli` that is the scratch HOME, and the server reads the same file. Never run a bare `node bin/tokenomics.ts build` in your own shell, because that overwrites the user's real snapshot.
- Rebuilds are incremental through the memo, so a rebuild with no new logs finishes fast and changes only `builtAt`. That is still a valid proof.
- `cursor-csv` shows `not found` unless the user has dropped Cursor CSV exports into `~/.tokenomics/imports/cursor`. That is expected, not a failure.
- The `click:` step waits for `Rebuilding…` to clear, so its auto-capture already shows the finished rebuild. Capture `state:before` explicitly.
