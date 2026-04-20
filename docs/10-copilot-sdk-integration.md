# Part 10: Copilot SDK Integration

> The GitHub Copilot SDK provides a programmatic surface for everything PAW currently achieves through hooks.json, markdown contracts, and convention — with first-class support for custom agents, typed hooks, session persistence, and multi-agent orchestration.

> **See also**: [Part 0: Surface Routing](./00-surface-routing.md) — The SDK is one of three Copilot surfaces. Part 0 documents the divergence matrix, canonical event model, and adapter architecture that PAW uses to target all three surfaces from a single set of definitions.

---

## What the Copilot SDK Is

The [GitHub Copilot SDK](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/copilot-sdk) (`@github/copilot-sdk`, public preview as of April 2026) lets you build applications that interact with Copilot programmatically. Instead of declaring hooks in JSON and reading stdin/stdout, you get a typed TypeScript (or Python, Go, .NET, Java) client with first-class primitives for:

| Primitive                                             | What It Does                                                                                          | PAW Parallel                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **Custom Agents**                                     | Named agents with scoped tools, prompts, and MCP servers; runtime auto-delegates by intent            | `.github/agents/*.agent.md` declarative definitions     |
| **SDK Hooks** (`onPreToolUse`, `onPostToolUse`, etc.) | Typed callbacks on session lifecycle events with structured input/output                              | `hooks.json` + TypeScript-via-tsx stdin/stdout protocol |
| **Custom Skills**                                     | Loadable `SKILL.md` directories injected into session context                                         | `.github/skills/*/SKILL.md` (identical concept)         |
| **Session Persistence**                               | Pause, resume, and manage sessions across restarts with `sessionId`                                   | No current PAW equivalent — sessions are ephemeral      |
| **Steering & Queueing**                               | Redirect an active agent mid-turn or buffer follow-up tasks                                           | No current PAW equivalent — PAW hooks are reactive only |
| **System Message Customization**                      | Granular override of system prompt sections (replace, remove, append, prepend)                        | `copilot-instructions.md` + instruction files (coarser) |
| **MCP Server Attachment**                             | Per-agent MCP server configs                                                                          | MCP configured globally in VS Code settings             |
| **Telemetry**                                         | OpenTelemetry traces with W3C context propagation                                                     | `paw-logger.ts` (basic file logging)                    |
| **Microsoft Agent Framework**                         | Compose Copilot agents alongside Azure OpenAI, Anthropic, etc. in sequential/concurrent orchestrators | No equivalent — PAW is Copilot-only                     |

The SDK is not a replacement for PAW. It's a lower-level runtime that PAW could **orchestrate from above**, turning declarative PAW manifests into programmatic SDK sessions.

---

## Where PAW and the SDK Converge

PAW and the Copilot SDK solve overlapping problems from different directions:

```
┌──────────────────────────────────────────────────────────────────┐
│                           USER                                   │
│  "Fix the search component and add tests"                        │
└───────────────────────────┬──────────────────────────────────────┘
                            │
          ┌─────────────────┴─────────────────┐
          │                                   │
          ▼                                   ▼
┌─────────────────────┐           ┌──────────────────────┐
│   PAW (Today)       │           │  Copilot SDK         │
│                     │           │                      │
│ • hooks.json        │           │ • createSession()    │
│ • pawGates.ts       │           │ • customAgents[]     │
│ • .agent.md files   │           │ • onPreToolUse       │
│ • SKILL.md files    │           │ • onPostToolUse      │
│ • task lifecycle    │           │ • skillDirectories[] │
│ • paw.sqlite        │           │ • session persistence│
│                     │           │ • steering/queueing  │
│ Convention-driven   │           │ API-driven           │
│ Declarative         │           │ Programmatic         │
└─────────────────────┘           └──────────────────────┘
```

**PAW's advantage**: zero-dependency convention system. Drop files into directories, rely on naming patterns, and the orchestration emerges from hooks.json + copilot-instructions.md. Works today, requires no SDK installation.

**SDK's advantage**: typed runtime with real control flow. Hook callbacks receive structured input objects and return structured output. Agent delegation is automatic with lifecycle events. Sessions persist across restarts.

The synthesis: **PAW becomes the declarative management layer that compiles into SDK sessions.**

---

## Enhancement 1: Typed Hook Migration

### Current State (hooks.json + stdin/stdout)

PAW hooks communicate via JSON piped through stdin/stdout. This works but has friction:

- No type safety at the boundary — `readHookInput()` returns `unknown` and hooks parse ad-hoc
- No structured output beyond `continue` and `systemMessage`
- Cannot modify tool arguments or results
- Cannot deny a tool call (postToolUse can only report; preToolUse enforcement requires the violation ledger dance)

### SDK Enhancement

The SDK's `onPreToolUse` and `onPostToolUse` hooks provide:

```typescript
/**
 * SDK pre-tool hook — typed input, structured decisions.
 */
onPreToolUse: async (input: PreToolUseHookInput) => {
  // input.toolName, input.toolArgs are typed
  // Return permissionDecision: "allow" | "deny" | "ask"
  // Return modifiedArgs to rewrite arguments
  // Return additionalContext to inject instructions
  if (input.toolName === 'replace_string_in_file') {
    const filePath = (input.toolArgs as { filePath: string }).filePath;
    if (filePath.endsWith('.scss') && !filePath.includes('theme-tokens')) {
      return {
        permissionDecision: 'allow',
        additionalContext:
          'Style files outside the central theme must not contain color literals. Use theme variable tokens.',
      };
    }
  }
  return { permissionDecision: 'allow' };
};
```

```typescript
/**
 * SDK post-tool hook — can transform results, not just report.
 */
onPostToolUse: async (input: PostToolUseHookInput) => {
  // input.toolResult is the actual tool output
  // Return modifiedResult to change what the agent sees
  // Return suppressOutput to hide noisy results
  // Return additionalContext to add instructions
  if (
    input.toolName === 'run_in_terminal' &&
    input.toolResult?.exitCode !== 0
  ) {
    return {
      additionalContext:
        'Command failed. Check the health check output and fix violations before continuing.',
    };
  }
  return null; // pass through unchanged
};
```

### Migration Path for PAW

PAW's `pawSync.ts` could generate SDK hook configs instead of (or alongside) hooks.json:

```typescript
/**
 * Compile PAW hook definitions into SDK session hooks.
 * Each .paw/hooks/*.ts file maps to an onPreToolUse/onPostToolUse callback.
 */
function compileHooksToSDK(pawHooks: PawHookDefinition[]): SessionHooks {
  return {
    onPreToolUse: async (input) => {
      for (const hook of pawHooks.filter((h) => h.event === 'preToolUse')) {
        const result = await hook.handler(input);
        if (result?.permissionDecision === 'deny') return result;
      }
      return { permissionDecision: 'allow' };
    },
    onPostToolUse: async (input) => {
      for (const hook of pawHooks.filter((h) => h.event === 'postToolUse')) {
        const result = await hook.handler(input);
        if (result?.modifiedResult) return result;
      }
      return null;
    },
  };
}
```

**Key benefit**: The violation ledger (`VIOLATIONS_PATH`) dance becomes unnecessary. The SDK's `permissionDecision: "deny"` replaces the two-file enforcement loop (postToolUse writes ledger → preToolUse reads ledger) with a single callback that blocks directly.

---

## Enhancement 2: Programmatic Agent Lifecycle

### Current State (Markdown Contracts)

PAW's A→B→C lifecycle is convention-enforced:

1. Analyzer reads copilot-instructions.md, produces `.ignore/tasks/*.md`
2. Implementer checks for active task file, writes code, calls health check
3. CompletionAuditor reconciles checklist items

Agent handoff is implicit — a human or a prompt triggers the next agent. There's no runtime that enforces the sequence or passes typed state between phases.

### SDK Enhancement

The SDK's `customAgents` + `subagent.*` events create a **runtime-enforced** lifecycle:

```typescript
const session = await client.createSession({
  model: 'gpt-4.1',
  customAgents: [
    {
      name: 'paw-analyzer',
      description:
        'Read-only analysis agent that creates task summaries. Never modifies source code.',
      tools: ['grep', 'glob', 'view', 'read_file', 'semantic_search'],
      prompt: analyzerSystemPrompt, // loaded from .agent.md
      infer: true,
    },
    {
      name: 'paw-implementer',
      description:
        'Implements code changes following the task summary. Runs health checks after changes.',
      tools: [
        'view',
        'edit',
        'replace_string_in_file',
        'run_in_terminal',
        'read_file',
      ],
      prompt: implementerSystemPrompt,
      infer: true,
    },
    {
      name: 'paw-health-reviewer',
      description:
        'Runs the mandatory quality gate. Classifies findings as critical or warning.',
      tools: ['run_in_terminal', 'read_file'],
      prompt: healthReviewerSystemPrompt,
      infer: false, // only invoked explicitly after implementation
    },
  ],
  hooks: {
    onPreToolUse: pawPreToolUseHook,
    onPostToolUse: pawPostToolUseHook,
  },
  skillDirectories: ['.github/skills'],
});
```

The `tools` array per agent now **enforces** tool restrictions at the runtime level, not just via prompt instructions. The Analyzer literally cannot call `edit` or `replace_string_in_file` — the SDK blocks it.

### Sub-Agent Event Tracking

```typescript
session.on((event) => {
  switch (event.type) {
    case 'subagent.started':
      // Log to paw.sqlite: phase transition started
      pawDb.logPhaseStart(event.data.agentName, event.data.toolCallId);
      break;
    case 'subagent.completed':
      // Log completion, trigger next phase
      pawDb.logPhaseComplete(event.data.agentName, event.data.toolCallId);
      break;
    case 'subagent.failed':
      // Log failure, block completion
      pawDb.logPhaseFailure(event.data.agentName, event.data.error);
      break;
  }
});
```

**Key benefit**: The A→B→C lifecycle becomes a runtime guarantee instead of a convention that agents can (and do) violate.

---

## Enhancement 3: Session Persistence for Long Tasks

### Current State

PAW sessions are ephemeral. When a VS Code Copilot conversation ends, all context is lost. The task file in `.ignore/tasks/` provides a human-readable breadcrumb, but resuming means the next agent must re-read the task file, re-discover the codebase, and reconstruct the mental model from scratch.

### SDK Enhancement

The SDK's session persistence stores conversation history, tool call results, and planning state to disk:

```typescript
const session = await client.createSession({
  sessionId: `paw-${taskId}-${Date.now()}`,
  model: 'gpt-4.1',
  infiniteSessions: {
    enabled: true,
    backgroundCompactionThreshold: 0.8,
  },
});

// ... agent does analysis, writes task file ...

// Session state auto-persisted to ~/.copilot/session-state/paw-{taskId}-{ts}/
// Includes: conversation history, tool call results, planning state
```

Later, when resuming implementation:

```typescript
const resumed = await client.resumeSession(
  `paw-${taskId}-${originalTimestamp}`,
  {
    customAgents: [implementerAgent, healthReviewerAgent],
    agent: 'paw-implementer', // pre-select the next phase
  },
);

// The implementer sees the FULL conversation history from the analysis phase.
// No re-reading task files. No context reconstruction. No wasted tokens.
```

### Integration with paw.sqlite

PAW's session-end save hook currently writes findings to `paw.sqlite`. With SDK persistence, the hook could **also** save the SDK `sessionId`:

```typescript
// Session-end hook: save SDK session reference for future resumption
pawDb.saveSessionMapping({
  taskId: currentTask.id,
  sdkSessionId: session.sessionId,
  phase: 'analysis-complete',
  timestamp: Date.now(),
});
```

This enables a `paw resume` command that finds the last SDK session for a task and resumes from the exact point it left off.

**Key benefit**: Multi-day tasks (like large refactors) maintain full conversational context instead of relying on lossy markdown summaries.

---

## Enhancement 4: Steering for Real-Time Violation Correction

### Current State

When PAW's postToolUse hook detects a violation, the enforcement loop is:

1. `postToolUse` writes a violation ledger file (`VIOLATIONS_PATH`)
2. `preToolUse` reads the ledger and denies non-exempt tools
3. Agent fixes the violation
4. `postToolUse` re-checks, clears the ledger
5. Normal operation resumes

This works but is indirect. The agent doesn't know _why_ tools were denied until it reads the systemMessage from the original postToolUse result.

### SDK Enhancement

With the SDK's steering capability, PAW could **inject correction instructions mid-turn**:

```typescript
/**
 * PAW violation detected — steer the agent immediately.
 */
onPostToolUse: async (input: PostToolUseHookInput) => {
  const violations = checkFile(input.toolResult);
  if (violations.length > 0) {
    // Instead of the ledger dance, inject a steering message
    await session.send({
      prompt: `⚠️ Hard rule violations detected:\n${violations.join('\n')}\n\nFix these in the file you just edited before continuing.`,
      mode: 'immediate', // inject into current turn
    });
    return { suppressOutput: true }; // hide the raw tool result
  }
  return null;
};
```

**Key benefit**: The agent gets correction instructions _within the same turn_ rather than discovering tool denials on the next action. Faster feedback loop, fewer wasted tool calls.

---

## Enhancement 5: Skill Directories as First-Class SDK Config

### Current State

PAW skills live in `.github/skills/*/SKILL.md` and are loaded by VS Code Copilot through the `copilot-instructions.md` `<skills>` block. The agent must be instructed to `read_file` the SKILL.md — loading is not guaranteed.

### SDK Enhancement

The SDK's `skillDirectories` option makes skill loading **automatic and guaranteed**:

```typescript
const session = await client.createSession({
  skillDirectories: [
    '.github/skills/task-lifecycle',
    '.github/skills/project-lore',
    '.github/skills/content-format',
  ],
  disabledSkills: ['experimental-feature'],
});

// ALL skill content is injected into the session context automatically.
// No read_file calls needed. No "BLOCKING REQUIREMENT: load skill first" instructions.
```

The SDK even supports the same `SKILL.md` format with YAML frontmatter that PAW already uses:

```yaml
---
name: task-lifecycle
description: Manages agile task lifecycle for Copilot workflows
---
# Task Lifecycle Skill
...
```

### Migration Path

PAW's skill composition protocol (documented in Part 4) already defines `requires` dependencies. The SDK doesn't have this natively, but PAW's `pawSync.ts` could resolve the dependency graph and flatten it into the `skillDirectories` array:

```typescript
/**
 * Resolve skill dependencies and produce a flat list for SDK skillDirectories.
 */
function resolveSkillDirs(requested: string[]): string[] {
  const resolved = new Set<string>();
  for (const skill of requested) {
    const meta = readSkillMeta(skill);
    if (meta.requires) {
      for (const dep of meta.requires) {
        resolved.add(`.github/skills/${dep}`);
      }
    }
    resolved.add(`.github/skills/${skill}`);
  }
  return [...resolved];
}
```

**Key benefit**: Skills become load-guaranteed instead of load-hoped. The "BLOCKING REQUIREMENT" pattern in copilot-instructions.md becomes unnecessary because the SDK injects skill content before the first prompt.

---

## Enhancement 6: Quality Gates as SDK Custom Tools

### Current State

PAW quality gates are TypeScript files in `.github/PAW/gates/` that `pawGates.ts` auto-discovers and runs. They're invoked by `npm run health:check` — a terminal command the agent must know to call at the right time.

### SDK Enhancement

Each quality gate could be exposed as a **custom tool** that the SDK makes available to agents:

```typescript
import { defineTool } from '@github/copilot-sdk';

const runHealthCheck = defineTool('paw_health_check', {
  description:
    'Run PAW quality gates on the project. Returns critical and warning findings.',
  parameters: {
    type: 'object',
    properties: {
      gates: {
        type: 'string',
        description:
          "Comma-separated gate names to run, or 'all' for all gates",
      },
      targetFiles: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Specific files to check (optional, defaults to all changed files)',
      },
    },
  },
  handler: async (args) => {
    const results = await runPawGates(args.gates, args.targetFiles);
    return {
      critical: results.filter((r) => r.severity === 'critical'),
      warnings: results.filter((r) => r.severity === 'warning'),
      passed: results.every((r) => r.severity !== 'critical'),
    };
  },
});
```

Now the agent can _call the health check as a tool_ rather than running a terminal command and parsing stdout:

```
Agent: Let me check the health gates for the files I just changed.
→ Tool call: paw_health_check({ gates: "all", targetFiles: ["src/lib/search.tsx"] })
→ Result: { critical: [], warnings: [{ gate: "file-length", ... }], passed: true }
Agent: All critical checks pass. One file-length warning, which is non-blocking.
```

**Key benefit**: Health check results are structured data, not terminal output the agent must parse. The SDK's tool calling mechanism handles serialization, error propagation, and retry automatically.

---

## Enhancement 7: Memory-Augmented Sessions via L1 Injection

### Current State

PAW's `userPromptSubmitted` hook queries `paw.sqlite` and injects an L1 context summary (~200 tokens) via `systemMessage`. This is constrained by the hooks.json protocol — the hook runs once at prompt submission and cannot inject further context mid-session.

### SDK Enhancement

The SDK's `onUserPromptSubmitted` hook + `systemMessage.mode: "customize"` allows richer, more targeted context injection:

```typescript
const session = await client.createSession({
  systemMessage: {
    mode: 'customize',
    sections: {
      custom_instructions: {
        action: 'append',
        content: buildL1Context(pawDb), // inject paw.sqlite facts
      },
    },
  },
  hooks: {
    onUserPromptSubmitted: async (input) => {
      // Dynamic L1 injection based on the actual prompt content
      const relevantFacts = pawDb.queryRelevantFacts(input.prompt);
      if (relevantFacts.length > 0) {
        return {
          additionalContext: relevantFacts.map((f) => `• ${f}`).join('\n'),
        };
      }
      return null;
    },
  },
});
```

The SDK's `systemMessage.sections` API also opens the door for PAW to **control system prompt sections** directly — replacing the generic guidelines or tone sections with project-specific PAW content:

```typescript
systemMessage: {
  mode: "customize",
  sections: {
    code_change_rules: {
      action: "replace",
      content: "Follow the PAW quality gate rules. Do not use browser dialogs. Keep color literals in the central theme file. All declarations must have JSDoc.",
    },
    guidelines: {
      action: "append",
      content: "\n* Run npm run health:check before declaring any task complete\n* Check .ignore/tasks/ for active task files before starting work",
    },
  },
},
```

**Key benefit**: PAW moves from "append instructions and hope the agent reads them" to "replace specific system prompt sections with enforced rules."

---

## Enhancement 8: Microsoft Agent Framework Interop

### Current State

PAW is Copilot-only by design. The README explicitly states: "We have no plans to expand to other AI coding assistants."

### SDK Enhancement

The Copilot SDK's Microsoft Agent Framework (MAF) integration doesn't change PAW's Copilot-first position — it opens a **composition layer** where PAW-managed Copilot agents can participate in broader workflows alongside other providers.

```typescript
import { CopilotClient } from '@github/copilot-sdk';
import { SequentialOrchestrator, AIAgent } from 'microsoft-agents-ai';

const copilotClient = new CopilotClient();
await copilotClient.start();

// PAW's analysis agent — powered by Copilot, scoped by PAW rules
const analyzer = copilotClient.AsAIAgent({
  Instructions: pawAnalyzerPrompt,
  Tools: [pawHealthCheck, readFileSecure],
});

// A specialized agent from another provider (e.g., Claude for creative content)
const contentDrafter = AIAgent.fromAnthropic({
  model: 'claude-sonnet-4',
  instructions: 'Draft content following the provided templates.',
});

// PAW orchestrates the pipeline, MAF handles inter-agent communication
const pipeline = new SequentialOrchestrator([analyzer, contentDrafter]);
const result = await pipeline.RunAsync(
  'Create a new resource entry for the Widget system',
);
```

**Why this matters for PAW**: Teams that use PAW for code quality but also use other providers for content generation could have a unified orchestration layer instead of manual agent-switching.

This isn't about replacing PAW's Copilot identity. It's about PAW **managing** which agents (Copilot or otherwise) handle which phases — the A→B→C lifecycle becomes provider-agnostic while the quality gates remain Copilot-native.

---

## Enhancement 9: Observability Upgrade

### Current State

PAW logs to `paw.log` (file) and `paw.sqlite` (structured). There's no distributed tracing, no correlation between hook executions in a single session, and no standard way to visualize the enforcement timeline.

### SDK Enhancement

The SDK supports OpenTelemetry with automatic W3C Trace Context propagation:

```typescript
const client = new CopilotClient({
  telemetry: {
    filePath: '.paw/traces.jsonl',
    exporterType: 'file',
    captureContent: true,
    sourceName: 'paw-agent-session',
  },
});
```

Every tool call, hook invocation, and agent delegation gets correlated under a single trace. PAW's violation enforcement loop — currently invisible except in log files — becomes a traceable sequence:

```
Trace: paw-session-12345
  ├── tool:replace_string_in_file (src/search.tsx)
  │   └── hook:postToolUse → violation detected (color literal)
  ├── hook:preToolUse → deny (VIOLATIONS_PATH exists)
  ├── tool:replace_string_in_file (src/search.tsx) → fix applied
  │   └── hook:postToolUse → clean
  └── hook:preToolUse → allow
```

For teams running PAW in CI (Part 5), these traces could be exported to Grafana, Jaeger, or any OTLP-compatible backend for pipeline observability.

**Key benefit**: Debug "why did the agent get stuck in a violation loop?" with a visual trace instead of grepping log files.

---

## Implementation Roadmap

The enhancements above are ordered by pragmatism. Here's a realistic adoption sequence:

| Phase       | Enhancement                                                | Effort | Prerequisite                                                             |
| ----------- | ---------------------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| **Phase 0** | Install `@github/copilot-sdk` as devDep, create smoke test | Low    | SDK exits public preview                                                 |
| **Phase 1** | Skill directories (Enhancement 5)                          | Low    | Phase 0 — drop-in, PAW skills already use SKILL.md format                |
| **Phase 2** | Typed hooks (Enhancement 1)                                | Medium | Phase 0 — rewrite hook handlers as SDK callbacks instead of stdin/stdout |
| **Phase 3** | Quality gates as tools (Enhancement 6)                     | Medium | Phase 2 — requires SDK hook infrastructure                               |
| **Phase 4** | Session persistence (Enhancement 3)                        | Medium | Phase 0 — add sessionId tracking to paw.sqlite                           |
| **Phase 5** | Programmatic agents (Enhancement 2)                        | High   | Phases 1–3 — requires full SDK session management                        |
| **Phase 6** | Steering (Enhancement 4)                                   | Medium | Phase 5 — steering requires active session control                       |
| **Phase 7** | Memory injection (Enhancement 7)                           | Medium | Phase 4 — builds on session persistence                                  |
| **Phase 8** | Observability (Enhancement 9)                              | Low    | Phase 0 — OpenTelemetry config is additive                               |
| **Phase 9** | MAF interop (Enhancement 8)                                | High   | Phase 5 — requires full programmatic agent setup                         |

### Dual-Mode Operation

During migration, PAW should support both modes:

```
┌──────────────────────────────────────────────────────────┐
│                      pawSync.ts                          │
│                                                          │
│  Input: .github/PAW/ manifests (gates, hooks, skills)    │
│                                                          │
│  ┌────────────────────┐  ┌─────────────────────────┐     │
│  │  Legacy Output     │  │  SDK Output              │    │
│  │                    │  │                           │    │
│  │  hooks.json        │  │  paw-sdk-config.ts        │   │
│  │  .paw/hooks/*.ts   │  │  Typed hook callbacks     │   │
│  │  stdin/stdout      │  │  SDK session config       │   │
│  └────────────────────┘  └─────────────────────────┘     │
│                                                          │
│  PAW_SDK_MODE=legacy | sdk | dual                        │
└──────────────────────────────────────────────────────────┘
```

This ensures teams can adopt SDK features incrementally without a hard cutover.

---

## What PAW Adds That the SDK Doesn't

The SDK is a runtime — it provides primitives. PAW provides **opinions** on top of those primitives:

| Concern                   | SDK Alone                               | PAW + SDK                                                 |
| ------------------------- | --------------------------------------- | --------------------------------------------------------- |
| Agent lifecycle           | You wire it yourself                    | A→B→C enforced with typed contracts and phase transitions |
| Quality gates             | You write custom tool handlers          | Drop `.gate.ts` files, auto-discovered and executed       |
| Hook management           | You register callbacks per session      | Declarative manifests compiled to SDK config              |
| Skill composition         | Flat `skillDirectories[]` array         | Dependency resolution with `requires`                     |
| Agent memory              | Session persistence (conversation only) | Structured paw.sqlite with decisions, patterns, hints     |
| Git integration           | Not addressed                           | Same gates run on commit and in CI                        |
| Cross-project portability | Per-project setup                       | `paw init` bootstraps everything                          |

PAW's value proposition doesn't diminish with the SDK — it **sharpens**. PAW becomes the project-level management layer that compiles into SDK sessions, rather than a workaround for the lack of an SDK.

---

## Open Questions

1. **Preview stability**: The SDK is in public preview. PAW should not take a hard dependency until the API surface stabilizes. Phase 0 should include a version-pinning strategy and an adapter layer to absorb breaking changes.

2. **hooks.json coexistence**: It's unclear whether VS Code will continue to support hooks.json alongside SDK-managed sessions, or whether the SDK subsumes the hook registration mechanism. PAW must support both paths during the transition.

3. **Copilot CLI dependency**: The SDK communicates with Copilot via the Copilot CLI (`copilot --headless`). PAW's current hooks run inside VS Code's hook runner. Bridging these two execution contexts — VS Code extension host vs. standalone CLI process — requires an adapter that may add latency.

4. **Multi-root workspace support**: The SDK's `skillDirectories` and `workingDirectory` are per-session. PAW needs to map its multi-root workspace conventions (if any) to SDK session configs.

5. **License implications**: The SDK requires a GitHub Copilot subscription. PAW's open-source posture means the SDK integration should be an optional enhancement, not a required dependency.
