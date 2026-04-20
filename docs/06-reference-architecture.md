# Part 6: Reference Architecture

> Complete directory layout, all interface definitions in one place, and step-by-step extension checklists.

---

## Quick Start (5-Minute Setup)

For a project that already has Node.js and TypeScript:

### 1. Install tsx

```bash
npm install --save-dev tsx typescript
```

### 2. Create tsconfig.scripts.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "noEmit": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "strict": true
  },
  "include": ["scripts/**/*.ts", ".github/scripts/**/*.ts"]
}
```

### 3. Create the Hook Runtime

Copy the `hook-runtime.ts` from [Part 1](./01-portable-hook-system.md) into `.github/PAW/hook-runtime.ts`.

### 4. Create hooks.json

Run `npm run paw:sync` to auto-generate `.github/hooks/hooks.json` from discovered hooks. Or create it manually:

```json
{
  "version": 1,
  "hooks": {
    "postToolUse": [
      {
        "type": "command",
        "bash": "npx tsx --tsconfig .paw/tsconfig.json .paw/hooks/post-tool-use.ts",
        "powershell": "npx tsx --tsconfig .paw/tsconfig.json .paw/hooks/post-tool-use.ts",
        "cwd": ".",
        "timeoutSec": 15
      }
    ]
  }
}
```

### 5. Create Your First Gate

Create `.paw/gates/no-console-log.gate.ts` (see [Part 2](./02-quality-gate-architecture.md) for the full pattern).

### 6. Wire npm Scripts

```json
{
  "scripts": {
    "health:check": "npx tsx --tsconfig tsconfig.scripts.json .github/PAW/pawGates.ts"
  }
}
```

You now have a working portable hook + health check system. Expand from here.

---

## Full Directory Layout

```
.github/
  hooks/
    hooks.json                          ← VS Code Copilot hook registration

  PAW/
    README.md                           ← This guide index
    docs/                               ← Architecture documentation (Parts 1–9)
    hook-runtime.ts                     ← Shared I/O protocol (HookResult, readInput, writeOutput)
    hooks/                              ← Default hook templates (skeletons)
      post-tool-use.ts
      pre-tool-use.ts
      session-end-health.ts
      session-end-memory-save.ts
      user-prompt-submitted.ts
    pawGates.ts                         ← Gate orchestrator (discovery + execution)
    pawHooks.ts                         ← Git hook configurator (install/uninstall)
    pawInit.ts                          ← Interactive bootstrapper (paw init)
    pawSync.ts                          ← Copies defaults into .paw/ and generates hooks.json
    paw-db.ts                           ← SQLite access layer (schema, queries)
    paw-paths.ts                        ← Central path constants
    paw-logger.ts                       ← Logging utilities
    health-check-types.ts               ← Shared type definitions (QualityGate, GateContext, etc.)
    gate-context.ts                     ← GateContext builder
    templates/                          ← Scaffolding templates (tsconfig, etc.)

.paw/                                   ← Project-specific installed content (gitignored)
  hooks/                                ← Active hooks invoked by VS Code
    post-tool-use.ts                    ← Quick lint hook (postToolUse)
    pre-tool-use.ts                     ← Violation enforcement gate (preToolUse)
    session-end-health.ts               ← Blocking health gate (calls pawGates.ts)
    session-end-memory-save.ts          ← Writes decisions/patterns/hints to paw.sqlite
    session-end-missing-tests.ts        ← Test coverage gate (sessionEnd)
    user-prompt-submitted.ts            ← L1 loader: queries paw.sqlite, injects facts
  gates/                                ← Drop gate files here (auto-discovered)
    file-length.gate.ts                 ← TypeScript gate (in-process import)
    duplicate-css.gate.ts
    jsdoc-quality.gate.ts
    antipatterns.gate.ts
    test-gaps.gate.ts
    content-format.gate.ts
    {custom}.gate.ts                    ← TypeScript gates
    {custom}.gate.py                    ← Python gate (subprocess, if runner configured)
    {custom}.gate.js                    ← Node.js gate (subprocess, if runner configured)
  git-hooks/                            ← Project-specific Git hook scripts
    commit-msg.ts                       ← Commit message validator
    submodule-guard.ts                  ← Submodule protection
    {custom}.ts                         ← Any project-specific pre/post scripts
  config.json                           ← Surface, runners, gitHooks, project paths
  paw.sqlite                            ← SQLite memory store (gitignored)
  violations.json                       ← Single-file violation ledger (gitignored)
  paw.log                               ← Runtime log (gitignored)
  tsconfig.json                         ← Script tsconfig for .paw/ hooks

  agents/
    analyzer.agent.md                   ← Phase A: Read-only analysis
    implementer.agent.md                ← Phase B: Code execution
    health-reviewer.agent.md            ← Phase B: Quality gate
    completion-auditor.agent.md         ← Phase C: Reconciliation
    {domain-agent}.agent.md             ← Optional: domain-specific agents

  skills/
    task-lifecycle/
      SKILL.md                          ← Task file format, completion validation
    {domain}/
      SKILL.md                          ← Domain knowledge module

  instructions/
    jsdoc-standards.instructions.md     ← applyTo: src/**/*.ts
    style-rules.instructions.md         ← applyTo: src/**/*.scss
    testing.instructions.md             ← applyTo: tests/**/*.test.*
    {domain}.instructions.md            ← applyTo: {glob}

  prompts/
    start-task.prompt.md                ← /start-task slash command
    full-workflow.prompt.md             ← /full-workflow slash command
    run-health.prompt.md                ← /run-health slash command
    reconcile-completion.prompt.md      ← /reconcile slash command
    fix-health.prompt.md                ← /fix-health slash command
    {workflow}.prompt.md                ← Custom slash commands

  workflows/
    ci.yml                              ← GitHub Actions pipeline

.ignore/
  tasks/                                ← Task files (gitignored or not, your choice)
    2026-04-09-143022-{title}.md
  reports/                              ← Completion reports
    2026-04-09-153045-report-{title}.md

tests/
  scripts/
    enforce-coverage.ts                 ← Test file existence enforcement
```

---

## .paw/config.json Schema

The project config is the single file that adapts PAW to the host project. All keys are optional — PAW uses sensible defaults when a key is absent.

```jsonc
{
  // Which Copilot surface to generate hook configs for
  "surface": "extension",           // "cli" | "extension" | "sdk" | "all"

  // Directories PAW scans for source files in gates
  "sourceDirectories": ["src/", "scripts/"],

  // Project-relative path to the tasks directory (consumed by session-end hooks)
  "tasksDir": ".ignore/tasks",

  // Domain keywords for automatic tagging of decisions and patterns
  "domains": ["metadata", "theme", "content", "testing"],

  // Gate runner configuration — maps file suffixes to execution strategies
  "runners": {
    ".gate.ts": "import",           // In-process dynamic import (default)
    ".gate.js": "node",             // Node.js subprocess
    ".gate.py": "python3"           // Python subprocess
  },

  // Git hook definitions — loaded by pawHooks.ts install
  "gitHooks": [
    {
      "name": "pre-commit",
      "flags": "--changed-only --staged",
      "description": "Run quality gates on staged files before commit",
      "appendCommands": ["npx tsx ... .paw/git-hooks/submodule-guard.ts"]
    },
    {
      "name": "commit-msg",
      "command": "npx tsx ... .paw/git-hooks/commit-msg.ts \"$1\"",
      "description": "Validate commit message format"
    }
  ]
}
```

| Key                  | Type       | Default         | Purpose                                                 |
| -------------------- | ---------- | --------------- | ------------------------------------------------------- |
| `surface`            | string     | `"extension"`   | Which Copilot surface adapter to use                    |
| `sourceDirectories`  | string[]   | `[]`            | Source directories for gate file scanning                |
| `tasksDir`           | string     | *(none)*        | Project-relative path to agile task artifacts            |
| `domains`            | string[]   | `[]`            | Domain keywords for automatic decision tagging           |
| `runners`            | object     | `{".gate.ts":"import"}` | Gate file suffix → execution command mapping    |
| `gitHooks`           | object[]   | pre-commit only | Git hook definitions with flags, commands, append        |

---

## All Interface Definitions

Consolidated from Parts 1–5 for copy-paste use.

### Hook System (Part 1)

```typescript
/* ── hook-runtime.ts ── */

export interface HookResult {
  continue: boolean;
  stopReason?: string;
  hookSpecificOutput?: {
    hookEventName: string;
    /** PostToolUse / SessionEnd: block further processing or allow */
    decision?: 'block' | 'allow';
    /** Human-readable reason for the decision */
    reason?: string;
    /** PreToolUse: allow, ask user, or deny tool execution */
    permissionDecision?: 'allow' | 'ask' | 'deny';
    /** PreToolUse: reason shown to agent when denying */
    permissionDecisionReason?: string;
  };
  systemMessage?: string;
}

export async function readHookInput(): Promise<Record<string, unknown>>;
export function writeHookOutput(result: HookResult): void;
export function writeBlockingOutput(result: HookResult): never;
export function resolveEditedFilePath(
  hookInput: Record<string, unknown>,
): string | undefined;
export function isNestedHookRun(hookInput: Record<string, unknown>): boolean;
```

> **Note on VS Code payload conventions**: VS Code chatHooks API v6 sends
> `tool_name` and `tool_input` (snake_case). Hooks should support both
> snake_case and camelCase variants for forward compatibility.

### QualityGate System (Part 2)

```typescript
/* ── health-check-types.ts ── */

export type GatePort =
  | 'code-quality'
  | 'content-structure'
  | 'test-coverage'
  | 'build-integrity'
  | 'custom';

export interface QualityGate {
  readonly id: string;
  readonly name: string;
  readonly port: GatePort;
  readonly severity: 'critical' | 'warning';
  readonly appliesTo: string[];
  readonly dependsOn?: string[];
  check(context: GateContext): Promise<GateResult>;
}

export interface GateContext {
  readonly rootDir: string;
  readonly mode: 'full' | 'changed-only';
  readonly changedFiles: ReadonlySet<string> | null;
  targetFiles(appliesTo: string[]): Promise<string[]>;
  readFile(relativePath: string): Promise<string>;
  git(command: string): string;
}

export interface GateResult {
  gate: string;
  passed: boolean;
  severity: 'critical' | 'warning' | 'info';
  findings: GateFinding[];
  stats: GateStats;
}

export interface GateFinding {
  file: string;
  line?: number;
  rule: string;
  message: string;
  suggestion?: string;
  severity?: 'critical' | 'warning';
}

export interface GateStats {
  filesChecked: number;
  findingsCount: number;
  durationMs: number;
  [key: string]: number;
}

export interface HealthReport {
  timestamp: string;
  mode: 'full' | 'changed-only';
  changedFiles: string[] | null;
  overall: 'PASS' | 'FAIL';
  summary: {
    totalGates: number;
    passed: number;
    failed: number;
    totalFindings: number;
    hasCritical: boolean;
  };
  gates: GateResult[];
}
```

### Agent Contracts (Part 3)

```typescript
/* ── agent-contracts.ts (conceptual — not compiled) ── */

export interface AnalyzerContract {
  input: { userRequest: string; projectContext: string };
  output: { taskFile: string; status: 'IN_PROGRESS' };
  constraints: string[];
}

export interface ImplementerContract {
  input: { taskFile: string; instructionFiles: string[] };
  output: {
    codeChanges: string[];
    taskFileUpdated: true;
    healthResults: string;
  };
  constraints: string[];
}

export interface HealthReviewerContract {
  input: { taskFile: string; instructionFiles: string[] };
  output: {
    verdict: 'PASS' | 'FAIL';
    findings: Array<{ severity: string; details: string }>;
    taskFileUpdated: true;
  };
  constraints: string[];
}

export interface CompletionAuditorContract {
  input: { taskFile: string };
  output: { reportFile: string; taskStatus: string };
  constraints: string[];
}
```

### Task Completion (Part 3)

```typescript
export interface ReconcileResult {
  complete: boolean;
  taskFile: string;
  status: string;
  sections: {
    dod: { checked: number; unchecked: number };
    milestones: { checked: number; unchecked: number };
    checklist: { checked: number; unchecked: number };
    healthResults: boolean;
  };
  incomplete: string[];
}
```

### Memory Store (Part 7)

```typescript
/* ── paw.sqlite schema (SQLite via better-sqlite3) ── */

/** decisions — architectural choices with temporal validity */
interface Decision {
  id: number;
  context: string;
  choice: string;
  rationale: string;
  domain: string | null;
  valid_from: string;
  superseded_at: string | null;
  superseded_by: number | null;
  source_task: string | null;
  created_by: 'agent' | 'user' | 'imported';
}

/** patterns — recurring codebase conventions with occurrence counting */
interface Pattern {
  id: number;
  name: string;
  description: string;
  example: string | null;
  domain: string | null;
  occurrences: number;
  first_seen: string;
  last_seen: string;
}

/** agent_memory — per-agent persistent hints */
interface AgentMemoryEntry {
  id: number;
  agent: string;
  hint: string;
  domain: string | null;
  confidence: number;
  created_at: string;
  updated_at: string;
}

/** task_index — cross-reference to task files */
interface TaskIndexEntry {
  id: number;
  file_path: string;
  title: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  domain: string | null;
  summary: string | null;
  created_at: string;
  completed_at: string | null;
}

/** remotes — federation pull sources */
interface Remote {
  id: number;
  name: string;
  path: string;
  transport: 'file' | 'http';
  last_pull: string | null;
  pull_filter: string | null;
  enabled: boolean;
}
```

---

## Extension Checklists

### How to Add a New Quality Gate

1. Create `.paw/gates/{name}.gate.ts` (or `.gate.{ext}` for other languages with a configured runner)
2. For TypeScript gates: export a `gate` constant implementing `QualityGate`
3. Set `id` (kebab-case), `name`, `port`, `severity`, `appliesTo`
4. Implement `check(context)` using `context.targetFiles()` and `context.readFile()`
5. Return a `GateResult` with findings
6. For non-TypeScript gates: configure the runner in `.paw/config.json` under `runners`
7. Test: `npm run health:check` — pawGates auto-discovers the new file

### How to Add a New Hook

1. Create `.paw/hooks/{name}.ts` (filename convention determines the event)
2. Import from `../../.github/PAW/hook-runtime`
3. Implement main function: `readHookInput()` → logic → `writeHookOutput()`
4. Run `npm run paw:sync` — pawSync auto-discovers hooks from `.paw/hooks/` and regenerates hooks.json
5. Filename conventions: `pre-tool-use-*` → PreToolUse, `post-tool-use-*` → PostToolUse, `session-end-*` → Stop, `user-prompt-*` → UserPromptSubmit

### How to Add a New Agent

1. Create `.github/agents/{name}.agent.md`
2. Add YAML frontmatter: `name`, `description`, `tools` list
3. Define the agent's mission, instruction loading table, constraints, and handoff protocol
4. Decide where it fits in the A→B→C lifecycle (or if it's a domain-specific extension)
5. Update the AGENTS.md registry

### How to Add a New Instruction File

1. Create `.github/instructions/{domain}.instructions.md`
2. Add `applyTo` glob in YAML frontmatter
3. Document: Hard Rules, Patterns, Anti-Patterns, Verification
4. Add the glob → instruction mapping to agent instruction tables

### How to Add a New Skill

1. Create `.github/skills/{name}/SKILL.md`
2. Add frontmatter: `name`, `description`, optionally `requires: [deps]`
3. Document: Purpose, When to Use, Detailed Guidance
4. Register in the skills list in `copilot-instructions.md`

### How to Add a New Prompt

1. Create `.github/prompts/{name}.prompt.md`
2. Add frontmatter: `description`, `agent`
3. Write step-by-step instructions the agent should follow
4. Reference relevant skills and instruction files in the prompt body

### How to Add a New CI Job

1. Add job definition to `.github/workflows/ci.yml`
2. Set `needs:` for dependency ordering
3. Use `if: always()` for gates that should run regardless of prior failures
4. Upload artifacts for debugging (`actions/upload-artifact`)

### How to Record a Decision

1. During a session, document the decision in the task file's Notes section using the format: `Decision: {context} → {choice} ({rationale})`
2. The session-end memory save hook extracts these and INSERTs them into `paw.sqlite`
3. To supersede an existing decision, note: `Supersedes: {old context} → {new choice} ({rationale})`
4. Verify: query `SELECT * FROM decisions WHERE superseded_at IS NULL ORDER BY valid_from DESC LIMIT 10`

### How to Set Up Git Hooks (Replace Husky)

1. Configure hooks in `.paw/config.json` under `gitHooks` — set `name`, `flags`, and optional `command`/`appendCommands`
2. Run `npx tsx --tsconfig tsconfig.scripts.json .github/PAW/pawHooks.ts install`
3. To remove: `pawHooks.ts uninstall` — only removes PAW-generated hooks
4. See [Part 8: Huskys Need PAWs](./08-huskys-need-paws.md) for migration guide and full details

### How to Add a Federation Remote

1. Ensure the remote `paw.sqlite` is accessible (file path, synced folder, or future HTTP endpoint)
2. Insert into the `remotes` table: `INSERT INTO remotes (name, path, transport) VALUES ('name', '/path/to/remote/paw.sqlite', 'file')`
3. Optionally set `pull_filter` to limit what gets imported (e.g., `"domain = 'testing'"`)
4. Run the pull script: `npx tsx --tsconfig tsconfig.scripts.json .github/scripts/paw-pull.ts`
5. Review imports: `SELECT * FROM imported_decisions WHERE accepted = 0`
6. Accept useful imports: the accept function promotes them to local decisions

---

## Design Principles Summary

| Principle                      | Implementation                                                              |
| ------------------------------ | --------------------------------------------------------------------------- |
| **Portability**                | TypeScript-via-tsx, identical bash/powershell commands, no shell scripts    |
| **Open/Closed**                | QualityGate adapters: extend by adding files, not editing orchestrator      |
| **Single Responsibility**      | Each gate checks one thing; each agent has one phase                        |
| **Dependency Inversion**       | Gates depend on `GateContext` abstraction, not concrete file walkers        |
| **Fail Open / Fail Safe**      | postToolUse hooks never block; sessionEnd hooks block only on critical      |
| **Transparency**               | JSON reports, task files, and completion reports create a full audit trail  |
| **Composability**              | Skills declare dependencies; gates declare execution order                  |
| **Same Code Everywhere**       | Local hooks, session gates, and CI all call the same pawGates.ts            |
| **Personal First**             | paw.sqlite is per-developer, works fully standalone; federation is additive |
| **Agents Don't Touch Storage** | All DB reads/writes flow through hooks; agents get injected context         |

---

## Related Documents

- [Part 1: Portable Hook System](./01-portable-hook-system.md)
- [Part 2: QualityGate Architecture](./02-quality-gate-architecture.md)
- [Part 3: Agent Ecosystem](./03-agent-ecosystem.md)
- [Part 4: Skills & Instructions](./04-skills-and-instructions.md)
- [Part 5: CI/CD Integration](./05-ci-cd-integration.md)
- [Part 7: Agent Memory Model](./07-agent-memory-model.md)
- [Part 8: Huskys Need PAWs](./08-huskys-need-paws.md)
