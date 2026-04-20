# PAW — Portable Agentic Workflows

A project-agnostic toolkit for building VS Code Copilot agentic workflow systems with portable hooks, extensible quality gates, and structured agent lifecycles.

> **Platform note**: PAW is currently engineered specifically for **GitHub Copilot** in VS Code. We have no plans to expand to other AI coding assistants at this time, but we welcome external contributions and input.

---

## What This Is

PAW documents a complete architecture for:

- **Copilot hooks** that run identically on Windows, macOS, and Linux — no shell scripts
- **Adapter-based health checks** (QualityGate pattern) where adding a check means dropping a file
- **Structured agent lifecycles** (Analysis → Implementation → Completion) with typed contracts
- **Composable knowledge modules** — skills, instructions, and prompts that feed agents contextual rules
- **CI integration** that runs the same gates locally and in pipelines

The patterns are extracted from a production workflow system and generalized for any TypeScript/Node.js project.

---

## Guide Structure

| Part | Document                                                           | What You'll Learn                                                                                                                                                  |
| ---- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | [Surface Routing](./docs/00-surface-routing.md)                    | Three Copilot surfaces (Extension, CLI, SDK), divergence matrix, canonical event model, adapter architecture, surface routing heuristics                           |
| 1    | [Portable Hook System](./docs/01-portable-hook-system.md)          | TypeScript-via-tsx hooks, hooks.json schema, stdin/stdout JSON protocol, cross-platform patterns, all three hook types                                             |
| 2    | [QualityGate Architecture](./docs/02-quality-gate-architecture.md) | `QualityGate` interface, FS-convention `PAW/gates/` directory, `pawGates.ts` orchestrator, `GateContext` for self-scoping, `--gates name,name` selective execution |
| 3    | [Agent Ecosystem](./docs/03-agent-ecosystem.md)                    | A→B→C lifecycle, agent contracts (Analyzer, Implementer, HealthReviewer, Auditor), task files as inter-agent communication                                         |
| 4    | [Skills & Instructions](./docs/04-skills-and-instructions.md)      | Three knowledge layers (auto instructions, explicit skills, user prompts), skill composition with dependency resolution, `applyTo` glob matching                   |
| 5    | [CI/CD Integration](./docs/05-ci-cd-integration.md)                | GitHub Actions pipeline, same pawGates.ts in CI, test enforcement, badge generation, PR comments                                                                   |
| 6    | [Reference Architecture](./docs/06-reference-architecture.md)      | Quick Start (5-min setup), full directory layout, all interface definitions, "How to add a new X" checklists                                                       |
| 7    | [Agent Memory Model](./docs/07-agent-memory-model.md)              | SQLite memory store (paw.db), L0→L1→L2 tiered agent loading, session-end save hook, decision supersession, pull-only federation                                    |
| 8    | [Huskys Need PAWs](./docs/08-huskys-need-paws.md)                  | Built-in Git hook configurator, replaces Husky + lint-staged, same gates for humans and agents, `--staged` scoping, migration guide                                |
| 10   | [Copilot SDK Integration](./docs/10-copilot-sdk-integration.md)    | GitHub Copilot SDK (`@github/copilot-sdk`) enhancement analysis — typed hooks, programmatic agents, session persistence, steering, skill loading, MAF interop      |

---

## Quick Start

If you want to get running fast, go directly to the [Quick Start in Part 6](./docs/06-reference-architecture.md#quick-start-5-minute-setup).

## Deep Dive

Start with [Part 1](./docs/01-portable-hook-system.md) and read sequentially — each part builds on the previous.

---

## Key Architectural Decisions

| Decision                                      | Rationale                                                                                                                                                                          |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Horizontal adapter layer**                  | Single canonical hook/agent/skill definitions compile to three surface-specific configs (Extension, CLI, SDK) via `PawSurfaceAdapter`. See [Part 0](./docs/00-surface-routing.md). |
| **TypeScript-via-tsx, no shell scripts**      | One command works on all platforms. Eliminates CRLF, quoting, and path separator bugs entirely.                                                                                    |
| **QualityGate FS convention**                 | Drop `.gate.ts` files into `PAW/gates/` — `pawGates.ts` auto-discovers and runs them. `--gates name,name` for selective execution.                                                 |
| **GateContext with targetFiles()**            | Gates self-scope instead of the orchestrator post-filtering. Enables smarter, lazier checks.                                                                                       |
| **Mandatory A→B→C lifecycle**                 | Forces architecture review before code, quality gate before completion, and reconciliation before close.                                                                           |
| **Task file as inter-agent medium**           | Markdown is human-readable, machine-parseable, and version-controllable. No database needed.                                                                                       |
| **Same code in hooks, session gates, and CI** | One pawGates.ts runs everywhere. No drift between local and CI behavior.                                                                                                           |
| **Built-in Git hook configurator**            | PAW writes `.git/hooks/` shims that call pawGates.ts — replaces Husky + lint-staged with zero extra config surfaces.                                                               |
| **Personal-first memory**                     | SQLite-backed paw.db gives each developer persistent agent memory. Federation is additive — the system works fully standalone.                                                     |
| **Tiered agent loading**                      | L0 (identity) → L1 (hook-injected facts) → L2 (on-demand skills). Keeps cold-start token costs near zero.                                                                          |

---

## Improvements Over Naive Approaches

This guide proposes five specific improvements over common first-generation systems:

1. **QualityGate Port/Adapter** — replaces hardcoded check arrays with auto-discovered, loosely-coupled gate modules
2. **Gate Context & Scoping** — replaces post-hoc filtering with self-scoped gates that receive pre-resolved file lists
3. **Hook Lifecycle Manager** — adds priority, dependencies, and conditions atop raw hooks.json command strings
4. **Structured Agent Contract** — formalizes implicit conventions into typed interfaces for cross-project interop
5. **Skill Composition Protocol** — adds `requires` dependency resolution so compound skills auto-load prerequisites
6. **SQLite Agent Memory** — persistent personal memory store with tiered loading, decision audit trails, and pattern recognition
7. **Pull-Only Federation** — share knowledge across instances via read-only remotes with provenance hashes and drift detection
8. **Unified Git Hooks** — PAW-managed Git hooks replace Husky + lint-staged, running the same gates humans get at commit time that agents get at session end
