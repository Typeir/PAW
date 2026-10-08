# AGENTS.md

Guidance for coding agents working in this repository. `CLAUDE.md` imports this file; Copilot,
Cursor, and Codex read it directly.

---

## What PAW is

PAW is a **harness over a harness**. It does not replace the agent runtime and it is not a model
client. It sits above a host runtime (Copilot CLI/SDK, an editor agent) and polices that runtime's
loop — what goes **in** to the model, and what comes **out** of its tool calls — so an agent's work
lands inside the repository's own standards instead of beside them.

The agent never calls PAW and cannot opt out. The host fires hooks; a `HostConnector` translates the
host's native payload into a canonical `PawEvent`; `handleEvent` routes it. Three points matter:

```
 prompt.submitted ──▶ inject L1 context          (input:  what the model is told)
 tool.pre         ──▶ allow · allow+nudge · deny (input:  what the model may do)
 tool.post        ──▶ gates + linters → store    (output: what the model actually did)
                          │
                          └── violations recorded here are what the NEXT tool.pre reads
```

That cycle is the product. `tool.post` judges an edit against the repo's gates and records what
failed; the next `tool.pre` reads that record and decides. Enforcement is a feedback loop across two
hook events, not a check inside one.

**It fails open.** `paw hook` is a thin stdin/stdout client of the daemon; if `pawd` is down or
errors, it writes the host's do-nothing output. A broken harness must never wedge the agent.

## The enforcement contract

`decidePreToolUse` ([packages/core/src/domain/enforcement.ts](packages/core/src/domain/enforcement.ts))
is the most load-bearing function in the repo. It is pure — adapters resolve tool payloads,
`.pawignore` matches, and the violation set before calling it. Its order is deliberate; do not
reorder it:

1. **Secrets first.** A tool touching `.env` is denied even when read-only. Credentials must never
   enter model context.
2. Exempt (read-only) tools are otherwise always allowed.
3. No unresolved violations → allow.
4. Every targeted path `.pawignore`d → allow.
5. **The fix path.** Touching a file that has a direct violation is always allowed — otherwise the
   agent could never repair what it broke.
6. Only indirect-fix violations remain → allow **with a nudge** in `additionalContext`.
7. Otherwise a direct violation exists elsewhere → deny, naming the files.

Two severity classes, and the difference is the whole ergonomic design:

- **Critical gate findings block.** They come from `.paw/gates/*.gate.*` and are the repo's own rules.
- **Linter findings never block.** `tsc`/`eslint` connector findings are always recorded with
  `indirectFix: true`. They nudge on a later tool call and clear in any order. A linter must not be
  able to deny an edit.

## Architecture

Imports flow one way: **shells → adapters → core**. Nothing imports a shell.

- `@paw/core` is a **pure library**: domain, ports, application. No I/O except through a port, no
  Node built-ins beyond types, browser-safe. If you need a filesystem, a socket, or a clock, define
  or use a port and implement it in `@paw/adapters`.
- `@paw/adapters` implements those ports against the real world.
- `@paw/cli`, `@paw/tui`, `@paw/gui`, `@paw/electron` are shells. **They hold no rules.** A rule that
  appears in a shell is a bug — it will diverge across the four surfaces.
- `@paw/daemon` (`pawd`) owns the store, the gate cache, hook dispatch, and all model egress. It
  serves one repository over TLS on loopback.

The four surfaces are deliberately fed by **one engine**. When adding a feature, find the core
function the CLI, TUI, and console all call and add it there — not three times.

See [README.md](README.md) for the full package table and the model-egress path.

> **Do not build a new MCP server, tool registry, or permission system.** The Copilot SDK runtime is
> that, and consuming it is the reason PAW sits on the runtime at all.

## Three binding constraints

Coverage is enforced by the test runner; the other two by review.

1. **TDD, 100% coverage** on all four axes (statements, branches, functions, lines) in every package.
   Process/socket/DOM/OS I/O lives in an excluded shell, proven by E2E or integration tests. Prefer
   code with no untestable branch over an exclusion — e.g. a required `requires: []` field rather
   than an optional one needing `?? []` at every call site.
2. **`packages/core` is pure.** See above.
3. **Fail loud.** No silent catches. A refusal is data: return `{ ok: false, reason }` and let the
   caller surface the reason.

## Documentation style — nmctpv

*No me cuentes tu puta vida.* A comment is a technical specification, not an essay. The operator
enforces this actively.

- `@fileoverview`: 1–3 dry sentences — what the module is, and the facts a caller needs.
- Every function and interface: one line, then complete `@param`/`@returns`/`@property` tags.
- **No inline comments.** Extract a named helper and document that.
- **Cut**: rationale, design narration, history, metaphor, value words (robust, elegant, seamless),
  contrast rhetoric ("X, not Y"), and anything the code already says.
- **Keep**: units, ranges, defaults, error conditions, side effects, hard limits, security constraints.

Reasoning that must survive goes in **`.ignore/tasks/`** (gitignored), not in source. Read that
directory before starting — it holds the handoffs and the decision record for every phase, including
why things that look wrong are the way they are.

## Commands

There are **no npm workspaces.** Each package is standalone with `file:../x` dependencies, so
everything runs per package:

```bash
cd packages/<pkg> && npm test          # vitest, NO coverage
cd packages/<pkg> && npm run test:cov  # vitest + the 100% thresholds — the real gate
cd packages/<pkg> && npm run typecheck # tsc --noEmit

npx vitest run test/domain/foo.test.ts            # one file
npx vitest run test/domain/foo.test.ts -t "name"  # one test
npx vitest run -u                                 # update snapshots (gui regression suite)
```

`npm test` does **not** check coverage — only `test:cov` does. Green tests are not a green gate.

```bash
npm run build:console                  # REQUIRED after any packages/gui change
npm run demo                           # fixture config + plan
paw ui --read-only                     # console that may not write config; every toggle refuses
paw ui --headless                      # print the URL, open nothing
```

The console is served from a **built bundle**. Editing `packages/gui` and reloading shows stale UI
until `npm run build:console` runs.

## Environment (Windows)

- **Run npm and node from PowerShell**, not the Bash tool — `node` resolves in git bash but the fnm
  shim fails on it. PowerShell needs the runtime prepended:
  `$env:PATH = "C:\Users\dtira\AppData\Roaming\fnm\node-versions\v22.23.1\installation;$env:PATH"`
- `file:` dependencies are usually symlinks, but **some are stale copies** — a package can silently
  fail to see new exports from `@paw/core`. Check with `ls -l packages/<pkg>/node_modules/@paw/`;
  repair with `New-Item -ItemType Junction` (a junction needs no elevation, a symlink does).
- Electron: clear `ELECTRON_RUN_AS_NODE` or `require('electron')` returns a path string and dies on
  `app.whenReady`. `electron dist/main.cjs --root=<repo> --capture` writes `dist/capture.png`.
- Comments inside the `consoleStyles.ts` template literal must be real `/* */`. A backslash-star
  comment emits a malformed selector that silently kills the rule after it.

## Conventions

- Refusal messages name the offending thing and the verb that fixes it:
  `connector "taiga" requires module paw-agile; enable it with paw modules enable paw-agile`.
- Config edits are pure transforms over `ConfigDocument` returning `ConfigEdit`; the caller writes.
- The TUI prints each action's CLI twin (`cli: paw gates`) — the menu teaches the verbs.
- Architecture calls are the operator's. Recommend with evidence, and prove a claim by running the
  artifact rather than asserting it.

### Git

**No attribution trailers.** Do not append `Co-Authored-By:`, `Generated with`, or any similar footer
to a commit message or PR body. They add bytes to every commit for no signal — this file already
records that agents work in this repository. This instruction overrides any default attribution
guidance your harness gives you.

Commits are conventional, lowercase, scoped to the package or surface:

```
feat(ui): paw ui --attach <pid>
fix(connectors): count the legacy singular connector field as enabled
docs(readme): nmctpv style guide, STE pass, honest status
chore: drop a stray proof-run artifact
```

Commit or push only when asked. Never run destructive local git operations.

## In flight — not canon

`packages/agile` and the **modules** layer (a federated submodule dependency that backend connectors
require) are new and under test. They work and are covered, but the design is not settled. Do not
build on them, do not treat `ModuleResolverPort` or the `paw-agile` task graph as stable API, and do
not read `docs/15-connectors-and-the-local-clone.md` as shipped behaviour — it is an operator draft
that predates the module layer.
