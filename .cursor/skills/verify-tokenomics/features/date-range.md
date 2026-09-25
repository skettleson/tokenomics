# Date range

The header's `Date range` group limits every chart, tile and recommendation to the last 7, 30 or 90 days (in local time), or back to all time. Dragging across `Cost per day` selects an arbitrary run of days. Either way, the result is a `day` range filter in the hash and a chip.

## Sub-features

- `dr-preset` applies `7 days`, `30 days` or `90 days` and marks that segment pressed.
- `dr-all-time` removes any day or week filter and marks `All time` pressed.
- `dr-brush` selects a custom day range by dragging on `Cost per day`.
- `dr-chip` removes the range with its `Remove filter day <from> → <to>` chip.

## How to get to it (user POV)

- Click `All time`, `7 days`, `30 days` or `90 days` in the header.
- Drag horizontally across the `Cost per day` chart. Dragging less than 4 px counts as a click instead.
- Click the `day … → …` chip or `Clear all`.

## Driving it with control-tokenomics

Preconditions:

- `$S doctor` exits 0, and the snapshot contains requests from the last 7 days. Otherwise the 7-day view is legitimately empty.

- **Preset.** Run `$S browser --label date-range open state:before "click:7 days"`. `dateRange` is `["7 days"]`, `hash` contains `day=<today-6>..<today>`, and a chip `Remove filter day <today-6> → <today>` appears. The `Sessions` tile is no greater than before.
- **Switch preset.** Append `"click:30 days"`. The `day=` part widens to 30 days, and only one `day` chip remains.
- **All time.** Append `"click:All time"`. `dateRange` is `["All time"]` and no `day` chip remains.
- **Brush.** Run `$S browser --label date-range open "drag:dailyCost/0.80-0.95"`. The chip `Remove filter day <from> → <to>` appears and `dateRange` is `[]`, because a custom range matches no preset.
- **Chip removal.** Append `"click:Remove filter day <from> → <to>"`, copying the name from the previous `chips`. The chip is gone.
- **Proof.** Keep the `before`, preset and brush `.state.json` files and PNGs. The PNG shows the pressed segment and the brushed band.

## Gotchas

- Presets are computed from *today* in the browser's time zone, and the snapshot's day labels come from the same zone. Near midnight, `7 days` can shift by a day between two runs.
- A preset replaces any `week` filter as well as the previous `day` filter.
- `drag` fractions are relative to the plot area. On a sparse history the right edge can hold mostly empty days, which produce an empty selection that is still valid.
- A click without movement on `Cost per day` hits a segment, not the brush. See `crossfilter.md`.
