# Crossfilter by clicking

Clicking a mark in any chart filters every other chart, the Summary tiles and the Recommendations to that selection. Each active filter appears as a removable chip in the sticky header and is encoded in the URL hash, so the view can be shared and reloaded.

## Sub-features

- `xf-bar` toggles a model or project filter from a bar in `Cost by model` or `Cost by project`.
- `xf-row` toggles a session filter from a row in `Most expensive sessions`.
- `xf-dot` toggles a session filter from a dot in `Sessions`.
- `xf-segment` toggles the stacked dimension (tool, model or project) from a segment in `Cost per day`, or toggles a week from `Token mix by week` or `Cache hit rate by week`.
- `xf-legend` toggles a tool from the `Cache hit rate by week` legend.
- `xf-chip` removes one filter with its chip. `xf-clear` removes all filters with `Clear all`.
- `xf-hash` restores filters from a deep link such as `#model=claude-opus-4-8`.

## How to get to it (user POV)

- Click a bar in `Cost by model` or `Cost by project`. Keyboard users can Tab to the bar and press Enter or Space.
- Click a row in `Most expensive sessions`, or a dot in `Sessions`.
- Click a coloured segment in `Cost per day`, or a week column in `Token mix by week` or `Cache hit rate by week`.
- Click a tool name in the `Cache hit rate by week` legend.
- Click a chip `<dim>: <value>  ×` or `Clear all` in the header.
- Open a URL with a filter hash.

## Driving it with control-tokenomics

Preconditions:

- `$S doctor` exits 0.
- `open` shows no chips. Read a bar name from `pressedBars` after a first click, or from the screenshot. `claude-opus-4-8` is an example.

- **Bar filter.** Click a model bar. Run `$S browser --label crossfilter open state:before "click:costByModel/claude-opus-4-8"`. `02-click-costbymodel-claude-opus-4-8.state.json` has `hash` `#model=claude-opus-4-8`, `chips` `["Remove filter model: claude-opus-4-8"]` and `pressedBars` `["claude-opus-4-8"]`. The `Cost` value in `kpis` is lower than in `01-before.state.json`, and `recommendations` differs.
- **Chip removal.** In the same invocation, append `"click:Remove filter model: claude-opus-4-8"`. `chips` is `[]`, `hash` is `""` and `kpis` equal the `before` values again.
- **Toggle off by clicking again.** `open "click:costByModel/claude-opus-4-8" "click:costByModel/claude-opus-4-8"` ends with no chips.
- **Session row.** Run `$S browser --label crossfilter open "row:topSessions/#1"`. `chips` has one `Remove filter session: <title>` entry, `selectedSessions` holds that title, and `hash` starts with `#session=`.
- **Scatter dot.** `click:sessionScatter/...` doesn't work because dots have no name. Use `eval:` only to *read* a dot's position, or prove this sub-feature through `row:` and state that the dot path was skipped.
- **Day segment.** Run `open "point:dailyCost/0.97,0.9"`. When a bar is under that point, a chip `Remove filter tool: <tool>` appears (the default stack is `tool`). When the point lands on an empty day, a `day` range chip appears instead. Read the chip to see which happened.
- **Week column.** Run `open "point:tokenMix/0.995,0.9"` (the rightmost week, low in the bar) or `open "point:cacheHitByWeek/0.9,0.5"`. A chip `Remove filter week: <week>` appears and `hash` is `#week=<monday>`. Running the same `point` again clears it.
- **Legend.** Run `open "click:cacheHitByWeek/claude-code"`. A chip `Remove filter tool: claude-code` appears.
- **Clear all.** Run `open "click:costByModel/claude-opus-4-8" "click:7 days" "click:Clear all"`. The last state has `chips` `[]`, `dateRange` `["All time"]`, and `hash` either `""` or just a `stack=` part.
- **Deep link.** Run `open:#model=claude-opus-4-8 state:deeplink`. The chip and `pressedBars` match the Bar filter result without any click.
- **Proof.** Keep the `crossfilter` folder: the before and after `.state.json` pair showing the chip, the hash and the changed Cost tile, plus the PNG with the pressed bar and the header chip visible.

## Gotchas

- Filters on the same dimension add up: clicking a second model bar adds it to the chip (`model: a, b`), it does not replace the first. Chip names with more than two values end in `+N`.
- A chart ignores its own dimension so the user can still see the alternatives: the model chart keeps every bar and dims the unselected ones (opacity 0.35). Assert on `pressedBars` and not on the bar count.
- When a date range excludes every request for the selected model, the bar disappears but the chip stays. `pressedBars` is then `[]` even though the filter is active.
- Bar labels longer than 28 characters are truncated with `…`. `click:` matches the full name by prefix, so pass the full name.
- `Token mix by week` spreads its weeks across the whole history, so most x positions fall on empty weeks, and a `point` there does nothing (`hash` is unchanged). Check `hash` after every `point`, and move toward a column visible in the PNG if it didn't change. Filters only narrow the data, so a `point` made while another filter is active can land on a column that has become empty.
- Project labels under the scratch HOME are absolute paths. Use the label exactly as `state` shows it.
