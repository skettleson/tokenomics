# Chart views

The user can change how charts present the same selection without filtering it. `Stack by` recolours `Cost per day` by tool, model or project. Each chart card's `Table` link swaps the chart for an accessible data table, and `Chart` swaps it back.

## Sub-features

- `cv-stack` stacks `Cost per day` by `tool` (the default), `model` or `project`, persisted as `stack=` in the hash.
- `cv-table` toggles a card between chart and table (`aria-pressed` on the toggle).

## How to get to it (user POV)

- Click `tool`, `model` or `project` in the `Stack by` group in the header.
- Click `Table` in the top-right corner of a chart card, then `Chart` to return. `Summary`, `Most expensive sessions` and `Sources` have no toggle.

## Driving it with control-tokenomics

Preconditions:

- `$S doctor` exits 0.

- **Stack by model.** Run `$S browser --label chart-views open "click:model"`. `stackBy` is `["model"]`, `hash` is `#stack=model` and `chips` is unchanged (`[]`). The PNG legend on `Cost per day` lists model names.
- **Stack back to tool.** Append `"click:tool"`. `hash` is `""`, because `tool` is the default and is not encoded.
- **Table toggle.** Run `$S browser --label chart-views open "click:costByModel/Table"`. `tablesShown` is `["chart-costByModel"]` and the PNG shows a table in that card. Append `"click:costByModel/Chart"`, and `tablesShown` is `[]`.
- **Proof.** Keep the PNG and state pairs for each toggle.

## Gotchas

- `click:model` matches the `Stack by` segment only because no other button is named exactly `model`. If a bar label ever equals `model`, `project` or `tool`, scope the click or check the `stackBy` field.
- The table toggle state is not in the hash, so it resets on `open`.
