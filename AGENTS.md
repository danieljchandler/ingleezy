# Ingleezy — agent brief

Read by every coding agent that opens this repo (Claude Code via `CLAUDE.md`'s
`@AGENTS.md`; Codex, Antigravity and Hermes directly). The global brief in
`agent-config/AGENTS.md` still applies. What the app is and how to run it: `README.md`.

## Memory map
- Hub: `projects/ingleezy.md` in the vault (state, decisions, open items; read it first)
- NotebookLM: none
- Chan Plan project: none
- Drive: `C:\ai\projects\english-app` (machines A and B only, not in a cloud session)

## Checks

What CI runs (`.github/workflows/ci.yml`), in order: `npm run typecheck`,
`npm run lint:ratchet`, `npm run test:coverage`, `npm run build`, and `npm run test:edge`
for the edge functions. `npm run check:edge` needs `deno`.
