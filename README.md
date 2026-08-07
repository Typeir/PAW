# PAW — Portable Agentic Workflows

A hexagonal, provider-agnostic engine for **release-and-capture agent swarms** and **quality
enforcement**, with a live console that reads real host state. A pure core library that thin driving
shells — a CLI, a TUI, a React web console, an Electron desktop shell — and a local daemon consume.

> **⛓ Binding constraints** — on the `feat/hex-tdd-restoration` branch, three hard rules govern all work
> enforced as **checks** — coverage by the test runner, the rest by review: **(1) TDD, 100% coverage** (unit + E2E/integration + regression);
> **(2) `packages/core` is a pure library** the shells consume — DDD / hexagonal, one-way imports;
> **(3) fail loud** — no silent catches, no swallow-and-continue. See **[CONSTRAINTS.md](./CONSTRAINTS.md)**
> before touching `packages/`.

> **Providers**: PAW sits *on top of* the GitHub Copilot SDK **runtime** — the agentic harness (tools,
> hooks, permissions, sub-agents) — BYOK'd to a model. PAW is not a model client itself. Every model call
> goes through that runtime behind `ModelPort`; the provider is a `{baseUrl, key}` in a data table
> (DeepSeek, Ollama, OpenAI, Anthropic-format…), never a code path. **Verified 2026-08-07:** the SDK runs
> headless in-repo (`getAuthStatus`=false) with a custom-tool round-trip — see the model/BYOK path below.
> *Being removed:* a raw-`fetch` DeepSeek path (`cli/deepseekRuntime.ts`) that bypassed the runtime and so
> carried no tools — that is drift, not a provider.

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
| **@paw/daemon** | `pawd` | Reads **real** host facts, the owned process subtree, and a real config + plan from disk; runs the real doctor; serves the console over **TLS** at `/` on `127.0.0.1`, streams state over one authenticated `wss` socket, and answers `GET /api/state` for the boot read and for `curl`. A library (`runDaemon`) + a thin argv shell. |
| **@paw/electron** | — | A hardened desktop shell that runs `pawd` in-process and loads its loopback URL in a **frameless** window whose titlebar the console draws (drag, minimise, maximise, close over one narrow IPC channel). In a browser the same console draws no window chrome at all. Context isolation on, node integration off, sandbox on, strict CSP. |
| **@paw/installer** | `paw-setup` | Pure planners for OS/shell detection, PATH activation, repo-root discovery, and per-repo attach (`init`), behind injected ports. Packaged as a native binary via Node SEA. |

Every package holds at **100% coverage**; process/socket/DOM/OS I/O lives in an excluded shell and is
proven by an E2E or integration test.

---

## Architecture — the model / BYOK path

The one rule that keeps PAW a *tooling-over-provider* harness and not a raw model client: **every model
call goes through the Copilot SDK runtime, BYOK'd to a provider.** The SDK is the agentic harness (tools,
hooks, permissions); PAW orchestrates above it. The provider is data (a `{baseUrl, key}` row), the
credential is fetched at egress and never held in config, and the SDK is imported in exactly one file.

```
  consumers                  adapters                        core (pure — no I/O, no 3rd-party)
 ┌───────────┐              ┌─────────────────────┐         ┌────────────────────────────┐
 │ cli  tui  │              │ model/copilotSdk.ts │         │ ports/ModelPort            │
 │ gui       │──compose────▶│ createCopilotSdk-   │◀──impl──│   complete(req) → resp     │
 │ daemon    │              │   Model(SessionRun) │         │ application/roleRegistry   │
 └─────┬─────┘              │   [NO sdk import]   │         │   (role → model binding)   │
       │ provides the       └──────────┬──────────┘         │ ports/SecretPort           │
       │ SessionRun                    │ injected           └─────────────┬──────────────┘
       ▼                               │                                  │ egress only
 ┌──────────────────────────────┐     │      ★ PAW owns egress via CopilotRequestHandler.sendRequest():
 │ daemon: the SDK SessionRun    │◀────┘      it adds the key from SecretPort, performs the provider
 │  ★ the ONLY @github/copilot-  │            fetch, and reads `usage` from the response — real tokens,
 │    sdk import in the repo     │            and the key never reaches the runtime.
 │  createSession({ provider,    │──────▶   provider = { type, baseUrl } only. DeepSeek is one baseUrl,
 │    requestHandler })          │            not a code path; no key in config, ever.
 └───────────────┬───────────────┘
                 ▼
      ┌────────────────────────┐   headless: getAuthStatus().isAuthenticated === false.
      │ Copilot SDK runtime    │   The reason to sit on the SDK at all: tools + hooks + perms
      │ tools · hooks · perms  │   + sub-agents. A path that skips this is a raw client, not PAW.
      └────────────────────────┘

  ✗ DRIFT (removed): cli/deepseekRuntime.ts = raw fetch('/chat/completions').
    It satisfies ModelPort.complete() WITHOUT the SDK — no tools, no hooks — because a plain
    completion needs nothing the SDK uniquely gives. That shape is what invited the drift.

  ✔ DECIDED 2026-08-07: (1) ModelPort stays complete()→text; a tool-using AgentSessionPort comes
    later (lamp post below).  (2) egress is daemon-owned — the SDK + key live in pawd, faces RPC in.
    (3) usage comes from CopilotRequestHandler (PAW owns the provider call), since the SDK's
    sendAndWait exposes no token usage. Returning 0 would be a silent lie (Constraint 3).

  ⚠ Status: the ★ SDK SessionRun does NOT exist yet. Step 0 (done) only proved the SDK runs
    headless in-repo. Until step 4, the only model path is the ✗ drift above.
```

> ## 🚧 LAMP POST — future work: consume the SDK's tools, do **not** build a new MCP
>
> The tool-less `complete()` path above is deliberate — memory drafting and gate-explain need no tools.
> The **agentic** surface (a deferred `AgentSessionPort` for swarm reviewers: `view`/`grep`/`glob` + a
> `submit_finding` tool, read-only) is where PAW's whole reason for existing lives. When it lands:
>
> **Wire the Copilot SDK's *own* surface** — its 16 built-in tools (`view`, `grep`, `glob`, `edit`,
> `powershell`, `web_fetch`, `sql`, `task`/sub-agents…), its permission model, its hooks, **and its MCP
> client** — into those sessions via `defineTool` / `availableTools` / `excludedTools`.
>
> **Do NOT build a new MCP, a new tool registry, or a new permission/hook system.** The SDK already *is*
> that, and consuming it is the entire point of sitting on the runtime. Reinventing it is exactly the
> drift that turned a tooling-over-provider harness into "a lame DeepSeek harness with a funny hexagonal
> architecture." The day PAW grows its own MCP is the day it has lost the plot.

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
node bin/paw.mjs ui                                # prints https://127.0.0.1:<port>/#t=<credential>
node bin/paw.mjs ui --root=../other-repo           # serve a different repository
node bin/paw.mjs ui --config=custom/paw.json       # override the config (path is relative to --root)
node bin/paw.mjs ui --port=8971                    # pick the port
node bin/paw.mjs ui plans/lore.swarm.mjs           # open on a plan instead of picking one
node bin/paw.mjs ui plans/lore.swarm.mjs --run     # also releases that plan's herd; Herd tab + spend go real
node bin/paw.mjs ui plans/lore.swarm.mjs --run --live          # release through a real (BYOK) model instead
node bin/paw.mjs ui --context docs/style.md        # attach files to every member's brief

# The URL carries this boot's credential in its fragment — treat it like a password.
# The daemon serves TLS from a local CA it issues per machine; trust it once and the
# browser stops warning. Nothing here is ever elevated.
node bin/paw.mjs trust --dry-run                   # print the exact commands and the fingerprint
node bin/paw.mjs trust                             # install into your own user store

# Enforcement + validation
node bin/paw.mjs check                                        # stdin: an allow/deny decision (exit 0/2)
node bin/paw.mjs doctor <config.json>                         # validate config + role/capability bindings
node bin/paw.mjs swarm doctor|show|run <plan.swarm.mjs>       # validate · preview a brief · dispatch
node bin/paw.mjs swarm show <plan> 0 --context docs/style.md  # the dry-run, exactly as dispatch sends it

# Desktop + terminal
node bin/pawd.mjs [--root=DIR] [plan]                         # the daemon alone (console + live wire)
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
is not disclosed), the real config doctor, and the plan's pre-rendered briefs. A dead wire paints a loud
`daemon unreachable` banner rather than showing stale data as fresh. Electron loads the same URL; its CSP
grants `connect-src` to that origin alone.

---

## Status — built vs planned (honest)

**Built + verified (100% coverage):** core, adapters, connectors, cli, tui, the React console, daemon,
electron, installer. Live host data over an authenticated `wss` wire, TLS from a name-constrained local CA. Native
installer binary via Node SEA; PATH activation + repo hoist. **Swarm file-context** — attach file contents
to every member's brief via `--context a.ts,src/**` or a multi-select file tree in the console fed by
`/api/tree`; the rooted reader refuses `..` escapes and `.env*`, and the dry-run is byte-identical to dispatch.

**In progress / planned:**
- **BYOK through the SDK** — step 0 (done) verified the runtime runs headless in-repo (SDK pinned to `1.0.8`; Test A/B against a stub provider). The real SDK-backed `SessionRun` (daemon) and role-bound model layer (core/adapters) are next; the interim raw-`fetch` DeepSeek path is drift, being removed. See the model/BYOK path diagram above.
- **Bearer token** on the control API (loopback + owned-subtree only today; a per-boot token is next).
- **Console release** — the console prints the exact `--context` argument but cannot yet POST a run (no control API); the run leaves via the CLI.
- **Live herd states** (`running`/`failed`) — needs a per-member progress callback in core (dispatch is batch).
- **Gates, Keys, memory, keyring** — legacy root scripts (`pawGates.ts`, `pawDb.ts`, …) predate the hex rewrite and are pending migration into packages; the console shows honest placeholders until then.
- **Installer**: WiX MSI, code-signing, a release CI, and folding `path`/`init` into the single `paw` binary.

---

## Documentation

- **[CONSTRAINTS.md](./CONSTRAINTS.md)** — the enforced rules (read first).
- **[docs/12-the-console-and-the-daemon.md](./docs/12-the-console-and-the-daemon.md)** — the current console/daemon design.
- **[docs/13-the-secure-live-wire.md](./docs/13-the-secure-live-wire.md)** — the transport: the local
  CA and why it is safe to trust, the three gates and what each stops, the `paw.live.v1` frames, the
  session machine, and the threat model with its accepted residuals.
- **[.ignore/tasks/](../../.ignore/tasks/)** — active plans and handoffs (distribution/installer, 5b context selector).
- **[.ignore/research/byoksdk/](../../.ignore/research/byoksdk/)** — the BYOK + PAW decision record (docs 01–21).

The pre-hex design manifesto (`docs/00–11`) has been removed — the code, this README, and CONSTRAINTS.md
are the source of truth now.
