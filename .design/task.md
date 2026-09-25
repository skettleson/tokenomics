# Architect task: tokenomics

Design (do not implement) a local webapp that tracks token usage and cost for Claude Code, Cursor, and Codex from on-disk session data, and surfaces actionable trends and recommendations correlated across multiple charts.

Read first, in full:
- /Users/samuelkettleson/code/tokenomics/.design/grounding.md (observed data formats, gotchas, scale; this is the ground truth)
- /Users/samuelkettleson/.claude/local-marketplaces/cursor-plugins/pstack/skills/architect/SKILL.md
- /Users/samuelkettleson/.claude/local-marketplaces/cursor-plugins/pstack/skills/architect/references/runner-prompt.md (your discipline)
- /Users/samuelkettleson/.claude/local-marketplaces/cursor-plugins/pstack/skills/architect/references/rationale-template.md (shape of RATIONALE.md)
- /Users/samuelkettleson/.claude/local-marketplaces/cursor-plugins/pstack/skills/architect/references/design-red-flags.md

Hard constraints:
- Runs locally with `node` (v26). Minimize dependencies; zero runtime npm deps is a plus (node:sqlite, node:http exist). Charts in the browser may load one library from a CDN (cdn.jsdelivr.net) or be hand-rolled SVG.
- TypeScript is allowed only if it runs without a build step (Node 26 strips types natively for .ts files). Otherwise plain ESM JS with JSDoc-free code.
- NO code comments in the eventual implementation. Your sketch files may use `throw new Error('not implemented')` bodies and a separate RATIONALE.md; keep intent in names and types.
- Estimated vs measured data must be distinguishable end to end (Cursor local data is mostly estimates).
- "Done" means: a user opens the page and sees charts (cost over time by tool/model, token mix incl. cache, per-project and per-session breakdowns, etc.) plus a list of concrete recommendations, each linked to the evidence that triggered it, and filters that apply across all charts so trends can be correlated.
- Recommendations must be concrete and computed from data (e.g. cache hit rate low on project X, expensive model used for short sessions, runaway sessions, output-heavy sessions, Opus share rising week over week). Name the ones you would ship and the exact metric + threshold each uses.

Deliverables, written ONLY inside your output directory:
- RATIONALE.md per the template (Usage first, then Shape, Tradeoffs, Alternatives, Open questions, Next step). Leave "Synthesis decision" as "pending".
- A type/module sketch: the actual files you would create (file tree), with core types and function signatures and `not implemented` bodies. Keep it small and real.

Structural direction for YOUR candidate is in the spawn message. Push it to its strongest form; do not hedge toward a middle.
Report back a <=250 word summary of the shape and the path to your files.
