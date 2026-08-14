# PAW — Portable Agentic Workflows

A hexagonal, provider-agnostic engine for **agent swarms** and **quality enforcement**, with a live
console that reads real host state. A pure core library; thin shells consume it — a CLI, a TUI, a React
console, an Electron desktop shell, and a local daemon.

> **⛓ Binding constraints.** Three rules govern all work. Coverage is enforced by the test runner, the
> rest by review. **(1) TDD, 100% coverage** (unit + E2E/integration + regression). **(2) `packages/core`
> is a pure library** — DDD/hexagonal, one-way imports. **(3) Fail loud** — no silent catches.

> **Providers.** PAW runs on the GitHub Copilot SDK **runtime** — the agentic harness (tools, hooks,
> permissions, sub-agents) — BYOK'd to a model. PAW is not a model client. Every model call goes through
> that runtime behind `ModelPort`. A provider is a `{baseUrl, key}` row in `.paw/<name>.provider.env`
> (DeepSeek, Ollama, OpenAI, Anthropic-format), never a code path.

---

## Documentation style — nmctpv

**nmctpv** (*no me cuentes tu puta vida* — "don't tell me your life story") is the doc rule for this
repository. A comment is a technical specification, not an essay.

| Rule | Shape |
| --- | --- |
| `@fileoverview` | 1–3 dry sentences. What the module is, and the facts a caller needs. |
| Function/interface doc | One line, then its tags. Every `@param`, `@returns`, `@throws`, `@property` present. |
| Tone | Caveman: shortest description that says what the thing does. If caveman cannot say it, use strict **ASD-STE100** — one meaning per word, short sentences, approved vocabulary. |
| Inline comments | **None.** Extract a named helper and document that instead. |

**Cut**: rationale ("A must run before B because…"), design-decision narration, history, metaphor,
value words (robust, elegant, seamless), contrast rhetoric ("X, not Y"), and anything the code already
says. Reasoning that must survive goes in `.ignore/tasks/`, not the source.

**Keep**: units, ranges, defaults, error conditions, side effects, hard limits, and security
constraints. `setx truncates PATH at 1024 characters` is a fact and stays.

```ts
// ✗ nmctpv violation
/**
 * @fileoverview The executing half of the linter connectors. ESLint scopes to
 * the touched files and runs inline within the hook budget, whereas tsc type-
 * checks the whole project — it cannot check one file in isolation — which is
 * far slower than the 8s budget, so it runs detached, because the violation
 * store answers "what did this edit break", not "what does the project owe".
 */

// ✓ nmctpv
/**
 * @fileoverview Runs the enabled linter connectors. ESLint runs inline on the
 * touched files; tsc is whole-project and runs detached, single-flight, its
 * findings scoped to those files.
 */
```

---

## Architecture — the packages

Imports flow one way: shells → adapters → core.

| Package | Bin | What it is |
| --- | --- | --- |
| **@paw/core** | — | Pure domain + ports + application. Enforcement decisions, the swarm model, the role/capability registry, the doctor, the connector catalogue, the `PawSnapshot` contract. No I/O outside a port; browser-safe. |
| **@paw/adapters** | — | Driven adapters: process, store, gate runner, config document, recent routes. |
| **@paw/connectors** | — | `HostConnector` implementations translating a host's payload to/from canonical `PawEvent`/`PawResponse`. |
| **@paw/cli** | `paw` | The command surface. Holds no rules — routes to core. |
| **@paw/tui** | `paw-tui` | A `@clack/prompts` menu over the CLI's loaders. Every action prints its CLI twin. |
| **@paw/gui** | — | The React console (DDD-layered) rendering a live `PawSnapshot`. No design system — its own instrument-panel CSS. |
| **@paw/daemon** | `pawd` | Reads real host facts, the owned process subtree, config, and plans from disk. Serves the console over **TLS** on `127.0.0.1`, streams state over one authenticated `wss` socket, answers `GET /api/state`. Owns model egress. |
| **@paw/electron** | — | A hardened desktop shell. Frameless window, console-drawn titlebar over one IPC channel, context isolation on, node integration off, sandbox on, strict CSP, pinned certificate. |
| **@paw/installer** | `paw-setup` | Pure planners for OS/shell detection, PATH activation, repo discovery, and per-repo attach. |
| **@paw/cosmetics** | — | The shared palette. One colour language across CLI, TUI, and console. |

Every package holds **100% coverage**. Process/socket/DOM/OS I/O lives in an excluded shell, proven by
E2E or integration tests.

---

## Model egress

Every model call goes through the Copilot SDK runtime, BYOK'd to a provider. PAW owns egress: it adds
the key at the provider fetch and reads `usage` from the response, so the key never reaches the runtime
and token counts are real. The SDK is imported in exactly one file.

```
 shells ──compose──▶ adapters ──impl──▶ core/ports/ModelPort
    │                                        complete(req) → resp
    ▼
 daemon: SessionRun  ★ the only @github/copilot-sdk import
    │  createSession({ provider: { type, baseUrl }, requestHandler })
    ▼
 Copilot SDK runtime — tools · hooks · permissions · sub-agents
```

Credentials live in `.paw/<name>.provider.env` (`KEY`, `BASE_URL`, `TYPE`, optional `MODEL`), are
gitignored, and are read at egress. `PAW_PROVIDER` picks between several.

> **Do not build a new MCP, tool registry, or permission system.** The SDK is that, and consuming it is
> the reason to sit on the runtime.

---

## Run it

`paw` reaches the shims written by `paw-setup path`. From a clone, `bin/paw.mjs` runs the TypeScript
directly.

```bash
npm run build:console                  # build the page the daemon serves
npm run demo                           # serve the fixture config + plan

# Console — serves ONE REPOSITORY: host facts, PAW's process subtree, config,
# every *.swarm.mjs, the doctor. Opens the desktop shell, browser as fallback.
paw ui                                 # attaches to a running pawd when one serves this repo
paw ui --headless                      # print the URL, open nothing
paw ui --control                       # let the console write config, plans, and connectors
paw ui --root=../other-repo            # serve a different repository
paw ui --port=8971
paw ui plans/lore.swarm.mjs --run      # open on a plan and release its herd
paw ui plans/lore.swarm.mjs --run --live   # release through a real (BYOK) model
paw ui --context docs/style.md         # attach files to every member's brief

# The URL carries this boot's credential in its fragment — treat it like a password.
paw trust --dry-run                    # print the commands and the fingerprint
paw trust                              # install the local CA into your user store

# Enforcement + validation
paw check                              # stdin: an allow/deny decision (exit 0/2)
paw doctor <config.json>               # validate config + role/capability bindings
paw gates [--staged] [files…]          # run the quality gates
paw violations [--prune [file]]        # list or clear recorded violations
paw connectors [enable|disable <id>]   # the connector catalogue and its state
paw config <get|set> …                 # model and role bindings

# Swarm
paw swarm doctor|show|run <plan.swarm.mjs>       # validate · preview a brief · dispatch
paw swarm show <plan> 0 --context docs/style.md  # the dry-run, byte-identical to dispatch
paw swarm run <plan> --live --concurrency 10     # dispatch through a real model

# Other surfaces
paw tui                                # the terminal console
npm run pawd                           # the daemon alone, no console opened
npm --prefix packages/electron start   # the desktop shell
```

`npm run paw -- …` works for flagless commands; npm claims flags like `--port` even after `--`, so use
`paw` or `node bin/paw.mjs` when passing one.

> **The console is repo-scoped.** `paw ui` takes no config and no plan. The daemon walks the repository,
> uses `.paw/config.json` when present, lists every `*.swarm.mjs`, and the console picks between them —
> selecting one re-reads it from disk with no restart. A plan the repository does not hold is refused
> (404). A repo with no config still serves, and the doctor names the missing keys.

---

## The swarm

A plan is **code, not a template**: a `.mjs` whose default export carries `brief(args, member)`, which
generates each member's prompt. The doctor refuses a broken plan before a token is spent — member count,
brief renders, purity, file conflicts, resume keys, model resolution.

```js
// plan.swarm.mjs
export default {
  name: 'spell-lore', role: 'lore.author',
  args: { spells, preamble },
  members: (a) => a.spells.length,
  brief: (a, m, n) => `You are member ${m + 1} of ${n}…\n${a.preamble}\nSPELL "${a.spells[m].title}"…`,
  skip: (a, m) => !needsLore(a.spells[m]),     // pre-filter → 0 calls
  key:  (a, m) => a.spells[m].slug,            // idempotent resume
  model: (a, m) => a.spells[m].hard ? 'deepseek-reasoner' : undefined,  // per-member override
  availableTools: ['read', 'edit'],            // members edit files in place
};
```

Model selection is by **capability**: a plan declares a role, the config binds the role to a model, and
the registry checks the model satisfies the role's requirements. A plan `model` resolutor overrides that
per member.

**Measured cost**: a 1,698-member JSDoc sweep over one repository (deepseek-chat, concurrency 10,
read+edit tools) cost **$1.91** — about $0.001 per file. Per-member context is the saving.

---

## Connectors

The catalogue ships in the build; there is no vendor endpoint. Enabled ids live in `.paw/config.json`
and are read per run, so enabling one takes effect on the next edit with no restart.

| Id | Kind | What enabling does |
| --- | --- | --- |
| `copilot-hooks` | host | Bridges Copilot editor-agent hook events into the enforcement loop. |
| `tsc` | linter | Type errors on touched files become deferred violations. |
| `eslint` | linter | Lint findings on touched files become deferred violations. |

Linter findings are **always deferred** (`indirectFix`): they nudge on the next tool call, never deny
one, and clear in any order. Only a critical gate finding blocks.

---

## Live console + daemon

`pawd` binds loopback on an ephemeral port and serves a `PawSnapshot` that is real, not mocked: real
`process`/`os` facts, PAW's **owned process subtree** (never the whole host table), the real doctor, and
pre-rendered briefs. A dead wire paints a `live wire down` banner rather than showing stale data as
fresh. A booting daemon records its endpoint, so a later `paw ui` attaches instead of starting a second.

---

## Status

**Built, verified, 100% coverage:** core, adapters, connectors, cli, tui, React console, daemon,
electron, installer, cosmetics. Live host data over an authenticated `wss` wire; TLS from a
name-constrained local CA. BYOK model egress through the SDK runtime, with scoped provider envs and real
token counts. Swarm release from the console (approved at the owning terminal), live per-member herd
states, file-context attachment, plan create/delete, the log ring with JSONL persistence, the provider
roster (key-free), the connector catalogue, and linter connectors reporting deferred violations.

**Planned:**
- **Gates view** — needs a control-gated endpoint that runs `GateRunner.runForFiles` daemon-side.
- **Swarm run-log tab** — per-run member stream in the console.
- **Live registry ↔ config bindings** — a live herd binds the plan role to one resolved provider/model;
  `.paw/config.json` role→model bindings are honoured by doctor and TUI only.
- **tsc baseline diff** — whole-project findings outside the touched files are dropped today.
- **Installer**: WiX MSI, code-signing, release CI, and folding `path`/`init` into one `paw` binary.

---

## Documentation

- **[docs/12-the-console-and-the-daemon.md](./docs/12-the-console-and-the-daemon.md)** — console/daemon design.
- **[docs/13-the-secure-live-wire.md](./docs/13-the-secure-live-wire.md)** — the transport: the local CA,
  the three gates, the `paw.live.v1` frames, the session machine, the threat model.
- **[.ignore/tasks/](./.ignore/tasks/)** — active plans, handoffs, and the reasoning behind decisions.
