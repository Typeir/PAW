# Part 0: Surface Routing — The Horizontalization Preamble

> Microsoft ships three independent Copilot agent surfaces — the VS Code Extension, Copilot CLI, and Copilot SDK — each with overlapping but incompatible hook formats, event naming, agent definitions, and skill loading. PAW abstracts over all three via an adapter layer, compiling a single set of canonical hook/agent/skill definitions into surface-specific configs.

---

## Why This Document Exists

PAW was originally built for one surface: the VS Code Extension, using `hooks.json` in CLI format (which VS Code auto-converts). But Copilot now runs in three distinct contexts:

1. **VS Code Extension** — interactive IDE sessions with real-time agent chat
2. **Copilot CLI** (`copilot` command) — terminal automation, CI pipelines, headless programmatic mode
3. **Copilot SDK** (`@github/copilot-sdk`) — programmatic orchestration, custom applications, multi-agent frameworks

These three surfaces solve overlapping problems with **incompatible APIs**. Microsoft has kept them partially aligned — VS Code reads CLI-format hooks, skills are portable via the agentskills.io standard — but the divergences are significant enough that PAW needs an explicit adapter layer to target all three from a single canonical definition.

This document defines: what each surface is, how they diverge, when to use each one, and how PAW's adapter layer normalizes the differences.

---

## The Three Surfaces

### Surface 1: VS Code Extension

**Use case**: Interactive IDE development — agent sessions, inline chat, real-time file editing with visual feedback.

| Aspect              | Detail                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hook format**     | `.github/hooks/*.json` with PascalCase event names                                                                                                    |
| **Hook events**     | `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact`, `SubagentStart`, `SubagentStop`, `Stop` (8 events)                     |
| **Command schema**  | `{ type, command, windows, linux, osx, cwd, env, timeout }` — OS-specific overrides                                                                   |
| **Also reads**      | CLI-format hooks (auto-converts `camelCase`→`PascalCase`, `bash`→`osx`+`linux`, `powershell`→`windows`), Claude Code format (`.claude/settings.json`) |
| **Hook I/O**        | stdin JSON → TypeScript handler → stdout JSON (`HookResult` with `continue`, `systemMessage`, `hookSpecificOutput`)                                   |
| **Agents**          | `.github/agents/*.agent.md` — YAML frontmatter with `tools`, `handoffs`, `hooks`, `agents`, `model`, `target`                                         |
| **Skills**          | `.github/skills/*/SKILL.md` — progressive 3-level loading (discovery → instructions → resources)                                                      |
| **Timeout default** | 30 seconds                                                                                                                                            |

**Unique capabilities**: Agent-scoped hooks (in `.agent.md` frontmatter), handoffs between agents with visual UI, `SubagentStart`/`SubagentStop`/`PreCompact` hook events, `/hooks` and `/create-hook` commands, Chat Customizations editor, model selection per agent.

### Surface 2: Copilot CLI

**Use case**: Terminal automation, CI pipelines, headless programmatic mode (`-p` flag), scripted workflows, local-first autonomous operation.

| Aspect              | Detail                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------- |
| **Hook format**     | `.github/hooks/*.json` with camelCase event names                                      |
| **Hook events**     | `userPromptSubmitted`, `preToolUse`, `postToolUse`, `sessionEnd` (4 documented events) |
| **Command schema**  | `{ type, bash, powershell, cwd, timeoutSec }` — simpler cross-platform format          |
| **Hook I/O**        | Same stdin/stdout JSON protocol as Extension                                           |
| **Agents**          | Same `.agent.md` files; auto-delegates to matching agents                              |
| **Skills**          | Same `SKILL.md` standard (agentskills.io)                                              |
| **Timeout default** | 15 seconds                                                                             |

**Unique capabilities**: `--allow-tool`/`--deny-tool`/`--allow-all-tools` CLI flags for tool approval, ACP (Agent Client Protocol) server mode, BYOK via environment variables (`COPILOT_MODEL_PROVIDER_*`), auto-compaction at 95% token limit, plan mode (`Shift+Tab`), inline rejection feedback, programmatic single-prompt mode (`-p`).

### Surface 3: Copilot SDK (`@github/copilot-sdk`)

**Use case**: Custom applications, backend services, multi-agent orchestration, session persistence across restarts, integration with Microsoft Agent Framework.

| Aspect              | Detail                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hook format**     | Programmatic callbacks in `createSession()` config                                                                                                    |
| **Hook events**     | `onPreToolUse`, `onPostToolUse`, `onUserPromptSubmitted`, `onSessionStart`, `onSessionEnd`, `onErrorOccurred` (6 callbacks)                           |
| **Command schema**  | N/A — hooks are TypeScript/Python functions, not shell commands                                                                                       |
| **Hook I/O**        | Typed function parameters → structured return objects (`permissionDecision`, `modifiedArgs`, `modifiedResult`, `additionalContext`, `suppressOutput`) |
| **Agents**          | `customAgents[]` in session config — `{ name, description, tools, prompt, mcpServers, infer }`                                                        |
| **Skills**          | `skillDirectories[]` + `disabledSkills[]` — flat loading (all skills loaded guaranteed, not on-demand)                                                |
| **Timeout default** | None (async callbacks)                                                                                                                                |

**Unique capabilities**: Session persistence (`sessionId` + `resumeSession()`), infinite sessions with background compaction, steering mid-turn (`mode: "immediate"`), queueing follow-up tasks (`mode: "enqueue"`), `systemMessage.sections` for granular system prompt control, `defineTool()` for custom tools, Microsoft Agent Framework (MAF) integration, OpenTelemetry traces with W3C context propagation, BYOK with structured provider config.

---

## Divergence Matrix

| Concern                  | Extension                                               | CLI                                   | SDK                                                |
| ------------------------ | ------------------------------------------------------- | ------------------------------------- | -------------------------------------------------- |
| **Hook event names**     | PascalCase (`PreToolUse`)                               | camelCase (`preToolUse`)              | camelCase callbacks (`onPreToolUse`)               |
| **Hook registration**    | JSON files in `.github/hooks/`                          | JSON files in `.github/hooks/`        | Programmatic session config                        |
| **Hook I/O protocol**    | stdin/stdout JSON                                       | stdin/stdout JSON                     | Typed function params/returns                      |
| **Tool blocking (pre)**  | `permissionDecision: "deny"` in `hookSpecificOutput`    | Same (via hooks.json)                 | `permissionDecision: "deny"` return value          |
| **Tool blocking (post)** | `decision: "block"` + `reason` top-level                | `decision: "block"`                   | `modifiedResult` / `suppressOutput`                |
| **Session end blocking** | `Stop` hook with `hookSpecificOutput.decision: "block"` | `sessionEnd` hook                     | `onSessionEnd` callback return                     |
| **Subagent lifecycle**   | `SubagentStart`, `SubagentStop` (dedicated events)      | Not documented separately             | `subagent.*` stream events                         |
| **Context compaction**   | `PreCompact` event (hook can influence)                 | Auto-compaction (no hook, no control) | `infiniteSessions` config (threshold control)      |
| **Agent definitions**    | `.agent.md` files with YAML frontmatter                 | Same `.agent.md` files                | `customAgents[]` inline objects                    |
| **Agent handoffs**       | `handoffs` in `.agent.md` YAML (visual UI)              | Not explicitly documented             | Not available (use steering instead)               |
| **Skill loading**        | Progressive (discovery → load → resources)              | Same progressive model                | Flat `skillDirectories[]` (all loaded immediately) |
| **Session persistence**  | Managed by VS Code UI (sessions view)                   | Session state + `/compact` command    | `sessionId` + `resumeSession()` with full history  |
| **Observability**        | VS Code output channels                                 | Terminal output                       | OpenTelemetry OTLP/file export                     |
| **Command format**       | `{ command, windows, linux, osx }`                      | `{ bash, powershell }`                | N/A (TypeScript functions)                         |
| **Timeout handling**     | 30s default, per-hook `timeout`                         | 15s default, per-hook `timeoutSec`    | No timeout (async callbacks)                       |

---

## PAW Canonical Event Model

PAW defines its own canonical event names that the adapter layer translates to each surface:

| PAW Canonical Event | Extension          | CLI                           | SDK                               |
| ------------------- | ------------------ | ----------------------------- | --------------------------------- |
| `session:start`     | `SessionStart`     | `userPromptSubmitted` (first) | `onSessionStart`                  |
| `prompt:submitted`  | `UserPromptSubmit` | `userPromptSubmitted`         | `onUserPromptSubmitted`           |
| `tool:pre`          | `PreToolUse`       | `preToolUse`                  | `onPreToolUse`                    |
| `tool:post`         | `PostToolUse`      | `postToolUse`                 | `onPostToolUse`                   |
| `session:end`       | `Stop`             | `sessionEnd`                  | `onSessionEnd`                    |
| `subagent:start`    | `SubagentStart`    | _(not available)_             | `subagent.started` stream event   |
| `subagent:stop`     | `SubagentStop`     | _(not available)_             | `subagent.completed` stream event |
| `context:compact`   | `PreCompact`       | _(auto, no hook)_             | `infiniteSessions` config         |
| `error`             | Exit code 2        | Exit code 2                   | `onErrorOccurred` callback        |

Hook handlers in `.paw/hooks/` are authored against PAW canonical names. `pawSync.ts` compiles them into the appropriate surface-specific format via the adapter layer.

---

## Surface Routing: When to Use Each

| PAW Capability                                                  | Primary Surface | Rationale                                                                          |
| --------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------- |
| **Interactive enforcement** (lint-on-edit, violation detection) | Extension       | Real-time editor feedback, agent-scoped hooks, visual violation messages           |
| **CI/CD gate pipelines**                                        | CLI             | Headless `-p` mode, `--allow-all-tools`, scriptable exit codes, no UI dependency   |
| **Multi-agent orchestration** (A→B→C lifecycle)                 | SDK             | Typed `customAgents[]` with tool scoping, `subagent.*` events, session persistence |
| **Git pre-commit gates**                                        | CLI             | `pawHooks.ts` generates git hook shims calling `pawGates.ts` — terminal-native     |
| **Session persistence** (resume long tasks)                     | SDK             | `sessionId` + `resumeSession()` with full conversational context                   |
| **Agent handoffs** (planning → implementation)                  | Extension       | `.agent.md` `handoffs` field with visual UI and prompt templates                   |
| **Steering & mid-turn correction**                              | SDK or CLI      | SDK: `mode: "immediate"` injection. CLI: enqueue messages interactively            |
| **Observability & debugging**                                   | SDK             | OpenTelemetry traces with W3C context propagation, structured spans                |
| **BYOK / custom models**                                        | CLI or SDK      | CLI: env vars (`COPILOT_MODEL_PROVIDER_*`). SDK: `provider` config object          |
| **Tool approval policy**                                        | CLI             | `--allow-tool`, `--deny-tool`, `--allow-all-tools` flags at invocation             |

### Decision Heuristic

```
Is this an interactive developer session?
  → Extension (hooks.json + .agent.md + visual UI)

Is this a terminal script, CI pipeline, or one-shot command?
  → CLI (copilot -p + tool flags + exit codes)

Do you need session persistence, typed orchestration, or MAF integration?
  → SDK (createSession() + customAgents[] + resumeSession())
```

---

## PAW Adapter Architecture

### The Problem

PAW's `pawSync.ts` currently generates hook configs in a single format (CLI-style camelCase with `bash`/`powershell` commands). This works because VS Code auto-converts CLI format to Extension format, but it:

- Cannot target Extension-only features (`SubagentStart`, `SubagentStop`, `PreCompact`, agent-scoped hooks)
- Cannot generate SDK programmatic session configs
- Cannot route different hooks to different surfaces
- Hard-codes the command format, preventing surface-specific optimizations

### The Solution: `PawSurfaceAdapter`

PAW introduces a `PawSurfaceAdapter` interface that abstracts hook/agent/skill config generation behind a common contract. `pawSync.ts` compiles PAW's canonical definitions through the appropriate adapter(s):

```
┌─────────────────────────────────────────────────────────────┐
│                  PAW Canonical Definitions                   │
│                                                             │
│  .paw/hooks/*.ts          (hook handlers)                   │
│  .github/agents/*.agent.md (agent definitions)              │
│  .github/skills/*/SKILL.md (skill modules)                  │
│  HOOK_REGISTRY[]          (event→file mappings)             │
└────────────────────────────┬────────────────────────────────┘
                             │
                      pawSync.ts
                      (adapter router)
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ CLIAdapter      │ │ ExtensionAdapter│ │ SDKAdapter      │
│                 │ │                 │ │                 │
│ camelCase events│ │ PascalCase evts │ │ TS callbacks    │
│ bash/powershell │ │ cmd/win/lin/osx │ │ typed functions │
│ hooks.json      │ │ hooks.json      │ │ sdk-session.ts  │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

### Surface Selection

`pawSync.ts` reads the target surface from `.paw/config.json`:

```json
{
  "surface": "cli"
}
```

Valid values: `"cli"` (default, backward-compatible), `"extension"`, `"sdk"`, `"all"`.

Environment variable override: `PAW_SURFACE=extension paw sync`

---

## Adapter Contracts

Each adapter implements the `PawSurfaceAdapter` interface:

```typescript
interface PawSurfaceAdapter {
  /** Surface identifier */
  readonly name: 'cli' | 'extension' | 'sdk';

  /** Generate hook config for this surface */
  generateHookConfig(hooks: PawHookDef[]): SurfaceHookOutput;

  /** Translate canonical PAW event to surface-specific name */
  getEventName(event: PawEvent): string | null;

  /** Format shell command for this surface's schema */
  getCommandFormat(script: string, timeout: number): Record<string, unknown>;
}
```

### CLIAdapter (extract of current behavior)

- Output: `.github/hooks/hooks.json` with `{ version: 1, hooks: { ... } }`
- Events: camelCase (`preToolUse`, `postToolUse`, `userPromptSubmitted`, `sessionEnd`)
- Commands: `{ type: "command", bash: "node .paw/hooks/...", powershell: "node .paw/hooks/...", cwd: ".", timeoutSec: N }`
- This is the **current** `pawSync.ts` behavior, extracted into an adapter

### ExtensionAdapter (new, Extension-native output)

- Output: `.github/hooks/hooks.json` with PascalCase events (or a separate file if CLI format is also needed)
- Events: PascalCase (`PreToolUse`, `PostToolUse`, `SessionStart`, `Stop`, `SubagentStart`, `SubagentStop`, `PreCompact`)
- Commands: `{ type: "command", command: "node .paw/hooks/...", windows: "node .paw/hooks/...", linux: "node .paw/hooks/...", osx: "node .paw/hooks/...", cwd: ".", timeout: N }`
- Unlocks: Extension-only events, agent-scoped hooks, OS-specific commands

### SDKAdapter (new, programmatic output)

- Output: `.paw/sdk-session.ts` — generated TypeScript with `createSession()` config
- Events: Mapped to callback properties (`onPreToolUse`, `onPostToolUse`, etc.)
- Commands: N/A — hooks are direct TypeScript function calls, not shell invocations
- Unlocks: Session persistence, steering, typed tool blocking, MAF integration

---

## Agent Lifecycle Per Surface

PAW's A→B→C lifecycle (Analyzer → Implementer → HealthReviewer → Auditor) maps differently per surface:

### Extension: Handoffs

```yaml
# .github/agents/Analyzer.agent.md
handoffs:
  - label: Start Implementation
    agent: Implementer
    prompt: 'Task summary created. Begin implementation.'
    send: false
```

Handoffs appear as clickable actions in the VS Code agent chat, enabling visual phase transitions.

### CLI: Sequential Programmatic Invocation

```bash
# Phase A: Analysis (read-only tools)
copilot -p "Analyze task: fix search component" \
  --allow-tool='grep' --allow-tool='glob' --allow-tool='view' \
  --deny-tool='edit' --deny-tool='write'

# Phase B: Implementation (full tools)
copilot -p "Implement changes per task file" --allow-all-tools

# Phase C: Health check
copilot -p "Run health check and report" \
  --allow-tool='shell(npm run health:check)'
```

The CLI's tool approval flags enforce the same restrictions that SDK tool arrays provide.

### SDK: Custom Agents with Runtime Tool Scoping

```typescript
customAgents: [
  {
    name: 'paw-analyzer',
    tools: ['grep', 'glob', 'view', 'read_file'],
    prompt: analyzerPrompt,
    infer: true,
  },
  {
    name: 'paw-implementer',
    tools: ['view', 'edit', 'replace_string_in_file', 'run_in_terminal'],
    prompt: implementerPrompt,
    infer: true,
  },
];
```

The `tools` array per agent enforces restrictions at the runtime level — the Analyzer literally **cannot** call edit tools.

---

## Migration Path

### Phase 1: Adapter Extraction (Non-Breaking)

Extract current `pawSync.ts` hook generation into `CLIAdapter`. The output is identical — `hooks.json` in CLI format. `pawSync.ts` calls `CLIAdapter.generateHookConfig()` instead of inline generation. **Zero behavioral change.**

### Phase 2: Extension-Native Output (Opt-In)

Add `ExtensionAdapter` that generates PascalCase hooks.json. Users opt in via `"surface": "extension"` in `.paw/config.json`. Unlocks SubagentStart, SubagentStop, PreCompact hooks.

### Phase 3: SDK Session Generation (Opt-In)

Add `SDKAdapter` that generates `paw-sdk-session.ts`. Requires `@github/copilot-sdk` as a peer dependency. Unlocks typed hooks, session persistence, steering.

### Phase 4: Multi-Surface Compilation

With `"surface": "all"`, `pawSync.ts` runs all adapters and writes to surface-specific output paths. A single `pawSync` invocation produces configs for all three surfaces simultaneously.

---

## Related Documents

- [Part 1: Portable Hook System](./01-portable-hook-system.md) — hook protocol details
- [Part 3: Agent Ecosystem](./03-agent-ecosystem.md) — A→B→C lifecycle
- [Part 4: Skills & Instructions](./04-skills-and-instructions.md) — knowledge layer architecture
- [Part 10: Copilot SDK Integration](./10-copilot-sdk-integration.md) — detailed SDK enhancement analysis
