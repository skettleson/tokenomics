# Grounding: local AI session data on this machine (observed 2026-09-24)

Runtime: macOS, Node v26.5.0 (has built-in `node:sqlite` with `DatabaseSync`, built-in `fetch`, `--watch`). Python 3.14, sqlite3 CLI. No bun. Project dir `/Users/samuelkettleson/code/tokenomics` is empty, not a git repo. User rule: NO code comments anywhere.

Goal (user's definition of done): a local webapp tracking token usage and cost for Claude Code, Cursor, and Codex. Done = actionable trends and recommendations can be correlated on a web UI with various charts of AI datapoints, built from session data.

## Claude Code — ~/.claude/projects/<dir-slug>/<sessionId>.jsonl (745 files, 929 MB, 22 project dirs; also nested `subagents/` jsonl)

One JSON object per line. `type` in: assistant, user, attachment, system, ai-title, custom-title, summary, etc. Assistant lines:

```
{ "type":"assistant", "sessionId", "uuid", "parentUuid", "isSidechain":false, "timestamp":"2026-07-30T16:41:34.334Z",
  "cwd", "gitBranch", "version":"2.1.219", "entrypoint":"claude-desktop"|"cli"..., "effort":"xhigh", "requestId",
  "message": { "id":"msg_...", "model":"claude-opus-5", "stop_reason":"tool_use",
    "content":[{type:"text"|"tool_use"|"thinking", name?(tool name), ...}],
    "usage": { "input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens",
      "cache_creation": { "ephemeral_1h_input_tokens", "ephemeral_5m_input_tokens" },
      "server_tool_use": { "web_search_requests", "web_fetch_requests" }, "service_tier", "speed":"standard"|"fast" } } }
```

GOTCHA: a single API response is written as multiple assistant lines (one per content block) that repeat the same `message.id` + usage. Dedupe by `message.id` (fallback `requestId`) or totals are inflated several-fold.
Models seen: claude-opus-5, claude-opus-4-8, claude-fable-5, claude-opus-5-5, claude-sonnet-5, claude-haiku-4-5-20251001, `<synthetic>` (ignore). `ai-title` / `custom-title` lines carry a session title. User lines with tool_result content are tool outputs, not human prompts.

## Codex — ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl (53 files, 18 MB)

Lines `{timestamp, type, payload}`. types: `session_meta` (payload.id, cwd, cli_version, originator, source), `turn_context` (payload.model e.g. "gpt-5.6-sol", cwd, effort), `response_item` (payload.type message|function_call{name}|reasoning), `event_msg` (payload.type user_message|task_started|task_complete|token_count).
token_count: `payload.info.last_token_usage = {input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens, reasoning_output_tokens, total_tokens}` and cumulative `total_token_usage`. `info` can be null. cached_input_tokens is a subset of input_tokens (OpenAI semantics).
On this machine most rollouts are imports whose per-field counts are 0 and only `total_tokens` is set. ~/.codex/state_5.sqlite `threads` table has id, rollout_path, created_at, model, tokens_used, title, cwd, git_branch, reasoning_effort (53 rows, 14,331 tokens total). ~/.codex/session_index.jsonl maps id -> thread_name.

## Cursor — ~/Library/Application Support/Cursor/User/globalStorage/state.vscdb (SQLite, 374 MB, open read-only: `file:...?mode=ro`)

Table `cursorDiskKV(key, value)`. `composerData:<composerId>` (108 rows): createdAt (ms), lastUpdatedAt, modelConfig.modelName ("cursor-grok-4.5-high-fast", "claude-sonnet-5-thinking-high", "gpt-5.6-sol-medium", "composer-2.5-fast", "default"...), maxMode, unifiedMode ("agent"|"chat"|...), name, contextTokensUsed (current context size, often null), fullConversationHeadersOnly [{bubbleId,type}], totalLinesAdded/Removed, isAgentic, subComposerIds.
`bubbleId:<composerId>:<bubbleId>` (8,850 rows): type 1=user 2=assistant, createdAt ISO, tokenCount {inputTokens, outputTokens} (almost always 0; only 2 bubbles non-zero), isAgentic, toolResults, text.
Cursor does not persist real per-request token counts locally. The authoritative source is Cursor's dashboard usage CSV export (cursor.com/dashboard -> Usage -> Export), columns roughly: Date, Kind, Model, Max Mode, Input (w/ Cache Write), Input (w/o Cache Write), Cache Read, Output Tokens, Total Tokens, Cost. None present on disk now.
Therefore Cursor numbers from local DB are ESTIMATES (context size, message counts). Any design must carry a per-datum fidelity notion (measured vs estimated) so the UI never presents estimates as measurements.

## Pricing
No price data exists locally. Cost must come from a maintained per-model price table (USD per 1M tokens for input, output, cache write (5m/1h), cache read) with prefix/alias matching of model names across vendors, and an "unknown model" bucket that is surfaced rather than silently priced at 0.

## Scale
Measured: 745 Claude files, 55,589 assistant lines, 24,071 unique message ids (2.3x duplication). A full Python parse of all Claude files takes ~3 s wall. Parse-on-every-request is borderline; parse-once-per-server-start with a file size+mtime cache is enough.

## Price facts (from the bundled claude-api skill, cached 2026-06-24; USD per 1M tokens)
Anthropic: input / output. Cache write 5m = 1.25x input, cache write 1h = 2x input, cache read = 0.1x input unless noted.
- claude-fable-5-1: 10 / 50, cache read 0.25 (0.025x)
- claude-fable-5: 10 / 50, cache read 1.00
- claude-opus-5-5: 4 / 20, cache read 0.20; fast mode 8 / 40 (2x)
- claude-opus-5, claude-opus-4-8, 4-7, 4-6: 5 / 25; opus-5 fast mode 10 / 50 (2x)
- claude-sonnet-5: 2 / 10
- claude-sonnet-4-6: 3 / 15
- claude-haiku-4-5: 1 / 5
Claude Code `usage.speed === "fast"` means fast-mode pricing (2x).
Non-Anthropic (gpt-5.6-sol, grok-*, composer-*): NO authoritative source on this machine. Ship as clearly labeled editable placeholders (source: "placeholder") so the UI can flag cost derived from them.
Cursor dashboard CSV rows carry their own Cost column; prefer it over computed cost when present.
