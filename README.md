# PAW — Portable Agentic Workflows

A hexagonal, provider-agnostic engine for **release-and-capture agent swarms** and **quality
enforcement**, with a live console that reads real host state. A pure core library that thin driving
shells — a CLI, a TUI, a React web console, an Electron desktop shell — and a local daemon consume.

> **⛓ Binding constraints** — on the `feat/hex-tdd-restoration` branch, three hard rules govern all work
> and are mechanically gated: **(1) TDD, 100% coverage** (unit + E2E/integration + regression);
> **(2) `packages/core` is a pure library** the shells consume — DDD / hexagonal, one-way imports;
> **(3) fail loud** — no silent catches, no swallow-and-continue. See **[CONSTRAINTS.md](./CONSTRAINTS.md)**
> before touching `packages/`.

> **Providers**: the GitHub Copilot SDK is the primary herder provider, but it runs behind a proxied
> `ModelPort` (`createCopilotSdkModel`), so the provider is swappable. BYOK is first-class — DeepSeek
> (OpenAI-compatible) is wired and verified end-to-end; Anthropic/Codex are a different adapter, not a rewrite.

---

## Architecture — the packages

`packages/core` is the only thing everything else depends on; imports flow one way (shells → adapters → core).

| Package | Bin | What it is |
| --- | --- | --- |
| **@paw/core** | — | Pure domain + ports + application. Enforcement decisions, the swarm briefing model, the role/capability registry, the doctor, the `PawSnapshot` wire contract. No I/O outside a port; browser-safe (the console bundles it). |
| **@paw/adapters** | — | Driven adapters implementing core's ports: process (`node:child_process`), store, and the model adapter (`createCopilotSdkModel` behind a `SessionRun` seam). |
| **@paw/connectors** | — | `HostConnector` implementations that translate a host's native payload (Copilot hooks today) to/from canonical `PawEvent`/`PawResponse`. Swapping hosts is a connector, selected by config. |
| **@paw/cli** | `paw` | The command surface: `check`, `doctor`, `swarm`, `ui`. Holds no rules — routes to core. |
| **@paw/tui** | `paw-tui` | A terminal console: a pure renderer + reducer behind a thin stdin shell. |
| **@paw/gui** | — | The **React** web console (DDD-layered), rendering a live `PawSnapshot`. No design system — its own instrument-panel CSS. |
| **@paw/daemon** | `pawd` | Reads **real** host facts, the owned process subtree, and a real config + plan from disk; runs the real doctor; serves the console at `/` and the live snapshot at `GET /api/state` on `127.0.0.1`. A library (`runDaemon`) + a thin argv shell. |
| **@paw/electron** | — | A hardened desktop shell that runs `pawd` in-process and loads its loopback URL in a **frameless** window whose titlebar the console draws (drag, minimise, maximise, close over one narrow IPC channel). In a browser the same console draws no window chrome at all. Context isolation on, node integration off, sandbox on, strict CSP. |
| **@paw/installer** | `paw-setup` | Pure planners for OS/shell detection, PATH activation, repo-root discovery, and per-repo attach (`init`), behind injected ports. Packaged as a native binary via Node SEA. |

Every package holds at **100% coverage**; process/socket/DOM/OS I/O lives in an excluded shell and is
proven by an E2E or integration test.

---

## Run it

There is **no published binary yet**, so `paw` is not on your PATH and the packages are TypeScript.
`bin/paw.mjs`, `bin/pawd.mjs`, and `bin/paw-tui.mjs` register `tsx` and run them **in the calling
process** — so the pid the daemon reports is the pid you launched. Run them from this directory
(`.github/PAW`):

```bash
# once — build the console page the daemon serves (without it, pawd serves a bootstrap page)
npm run build:console

# nothing to hand it yet? the fixtures are a working config + plan:
npm run demo                                      # builds the console, then serves the demo plan

# Live console — serves THIS REPOSITORY: host facts, PAW's own process subtree, its config,
# every *.swarm.mjs in it, and the doctor. One console per repo, not one per plan.
node bin/paw.mjs ui                                # opens http://127.0.0.1:<port>/ — pick a plan in it
node bin/paw.mjs ui --root=../other-repo           # serve a different repository
node bin/paw.mjs ui --config=custom/paw.json       # override the config (path is relative to --root)
node bin/paw.mjs ui --port=8971                    # pick the port
node bin/paw.mjs ui plans/lore.swarm.mjs           # open on a plan instead of picking one
node bin/paw.mjs ui plans/lore.swarm.mjs --run     # also releases that plan's herd; Herd tab + spend go real
node bin/paw.mjs ui plans/lore.swarm.mjs --run --live          # release through a real (BYOK) model instead
node bin/paw.mjs ui --context docs/style.md        # attach files to every member's brief

# Enforcement + validation
node bin/paw.mjs check                                        # stdin: an allow/deny decision (exit 0/2)
node bin/paw.mjs doctor <config.json>                         # validate config + role/capability bindings
node bin/paw.mjs swarm doctor|show|run <plan.swarm.mjs>       # validate · preview a brief · dispatch
node bin/paw.mjs swarm show <plan> 0 --context docs/style.md  # the dry-run, exactly as dispatch sends it

# Desktop + terminal
node bin/pawd.mjs [--root=DIR] [plan]                         # the daemon alone (console + /api/state)
node bin/paw-tui.mjs <config> <plan>                          # the terminal console
npm --prefix packages/electron start                          # the desktop shell (runs pawd in-process)
```

`npm run paw -- …` works for flagless commands, but npm claims flags like `--port` for itself even
after `--` — use `node bin/paw.mjs` whenever you pass one.

> **The console is repo-scoped.** `paw ui` takes no config and no plan: the daemon walks the
> repository, uses its `.paw/config.json` when it has one, lists every `*.swarm.mjs` it finds, and the
> console picks between them — selecting one re-reads it from disk, with no restart. A plan argument
> only chooses which one to open on, and `--run` releases that one. `--config` and a plan argument are
> both relative to `--root`, and a plan the repository does not hold is refused (404) rather than
> imported.
>
> **The config is a V1 config, not the legacy gate config.** `paw doctor` validates `root`,
> `gatesDir`, and `connector`, plus the `models` / `roles` bindings — see
> `packages/cli/test/fixtures/ready.config.json`. A repo whose `.paw/config.json` predates V1 still
> serves, and the doctor reports exactly which keys are missing rather than inventing a ready install;
> a repo with no config at all serves too, and says so.

```bash
# Install / activate (native binary; see @paw/installer — not built yet)
paw-setup path --dry-run                          # show the PATH change (no write); omit --dry-run to apply
paw-setup init --dry-run                          # attach PAW to the repo you're in (config + git hook), by reference
```

---

## The swarm — release and capture

A swarm plan is **code, not templates**: a `.mjs` whose **functional default export** carries a
`brief(args, member) => string` that generates each member's prompt. Claude Code *releases* a detached
herd in one turn and ends; the members graze unattended; a user *captures* the results later. The doctor
refuses a broken plan before a token is spent (member count, brief renders, purity, file-conflict, role).

```js
// plan.swarm.mjs
export default {
  name: 'spell-lore', role: 'lore.author',
  args: { spells, preamble },
  members: (a) => a.spells.length,
  brief: (a, m, n) => `You are member ${m + 1} of ${n}…\n${a.preamble}\nSPELL "${a.spells[m].title}"…`,
  skip: (a, m) => !needsLore(a.spells[m]),          // pre-filter → 0 calls
  key:  (a, m) => a.spells[m].slug,                 // idempotent resume
};
```

Model selection is by **capability**: a plan declares a role, the config binds a role to a model, and the
registry checks the model satisfies the role's requirements — so the provider is decoupled from the plan.

---

## Live console + daemon

`pawd` binds loopback only, on an ephemeral port, and serves a `PawSnapshot` that is **real, not mocked**:
real `process`/`os` facts, PAW's **owned process subtree** (never the whole host table — unrelated software
is not disclosed), the real config doctor, and the plan's pre-rendered briefs. A dead poll paints a loud
`daemon unreachable` banner rather than showing stale data as fresh. Electron loads the same URL; its CSP
grants `connect-src` to that origin alone.

---

## Status — built vs planned (honest)

**Built + verified (100% coverage):** core, adapters, connectors, cli, tui, the React console, daemon,
electron, installer. Live host data over `/api/state`. Real BYOK dispatch (`--live`, DeepSeek). Native
installer binary via Node SEA; PATH activation + repo hoist. **Swarm file-context** — attach file contents
to every member's brief via `--context a.ts,src/**` or a multi-select file tree in the console fed by
`/api/tree`; the rooted reader refuses `..` escapes and `.env*`, and the dry-run is byte-identical to dispatch.

**In progress / planned:**
- **Bearer token** on the control API (loopback + owned-subtree only today; a per-boot token is next).
- **Console release** — the console prints the exact `--context` argument but cannot yet POST a run (no control API); the run leaves via the CLI.
- **Live herd states** (`running`/`failed`) — needs a per-member progress callback in core (dispatch is batch).
- **Gates, Keys, memory, keyring** — legacy root scripts (`pawGates.ts`, `pawDb.ts`, …) predate the hex rewrite and are pending migration into packages; the console shows honest placeholders until then.
- **Installer**: WiX MSI, code-signing, a release CI, and folding `path`/`init` into the single `paw` binary.

---

## Documentation

- **[CONSTRAINTS.md](./CONSTRAINTS.md)** — the enforced rules (read first).
- **[docs/12-the-console-and-the-daemon.md](./docs/12-the-console-and-the-daemon.md)** — the current console/daemon design.
- **[.ignore/tasks/](../../.ignore/tasks/)** — active plans and handoffs (distribution/installer, 5b context selector).
- **[.ignore/research/byoksdk/](../../.ignore/research/byoksdk/)** — the BYOK + PAW decision record (docs 01–21).

The pre-hex design manifesto (`docs/00–11`) has been removed — the code, this README, and CONSTRAINTS.md
are the source of truth now.
