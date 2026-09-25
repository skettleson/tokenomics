# Recommendations

The Recommendations card evaluates cost rules against the current selection and lists findings. Each finding has a severity, a metric compared with its threshold, an estimated dollar impact and advice. Findings with the same rule and title are grouped into one card that has a subject table. `Show evidence` applies the filters that justify a finding and scrolls to the chart that shows it.

## Sub-features

- `rec-summary` shows `N recommendations in M groups for the current filters`, which follows every filter.
- `rec-single` is a single finding card with a `Show evidence` button.
- `rec-group` is a grouped card (`×N`) with a per-subject table, per-row `Evidence` buttons and a `Show all evidence` button.
- `rec-more` is `Show N more` / `Show fewer` on groups with more than 5 subjects.
- `rec-evidence` means evidence buttons overlay filters and scroll to the finding's chart.

## How to get to it (user POV)

- Scroll to the `Recommendations` card, just below Summary.
- Click `Show evidence` on a single card, `Evidence` on a group row (its name is `Show evidence for <subject>`), or `Show all evidence` on a group.
- Click `Show N more` on a large group.

## Driving it with control-tokenomics

Preconditions:

- `$S doctor` exits 0. Read `findingCards` from an `open state:before` capture to choose titles. Examples from one machine: `Runaway session ×4` and `Premium model on short sessions`.

- **Summary follows filters.** Run `$S browser --label recommendations open state:before "click:costByModel/<model>"`. `recommendations` changes between the two states.
- **Single finding evidence.** Run `open "click:Premium model on short sessions/Show evidence"`. `chips` gains a filter (for example `session: … +N`), `hash` contains the overlay, and the PNG shows the page scrolled to the focus chart.
- **Group evidence.** Run `open "click:Runaway session/Show all evidence"`. `hash` becomes `#session=<id>,<id>,…` with one id per subject in the group.
- **Row evidence.** Run `open "click:Runaway session/Show evidence for <subject>"`. Exactly one session chip appears.
- **Show more.** This only applies when a group has more than 5 subjects. Run `open "click:<title>/Show <k> more"`, then `"click:<title>/Show fewer"`, and compare the row counts in the PNGs. If no group qualifies, report `rec-more` as skipped with that reason.
- **Proof.** Keep the `before` state and each post-click state together with its PNG, which shows the card and the resulting chip.

## Gotchas

- Plain `click:Show evidence` matches every single-finding card and clicks the first one. Always scope it with `<Finding title>/`.
- After evidence is applied, the rules re-run on the narrowed selection, so the group you clicked can vanish or turn into a single card. Start each sub-feature from `open`.
- Values marked `≈` rest on estimated Cursor data. Thresholds live in `web/rules.ts`. Use `$S cli -- calibrate` to see why a rule does or doesn't fire.
