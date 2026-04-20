# Part 1: Portable Hook System

> Build cross-platform Copilot hooks using pre-compiled `.mjs` files — no shell scripts, no platform branching, no runtime dependencies beyond Node.

---

## Why Pre-Compiled .mjs

Traditional hook systems rely on `.sh` (Unix) and `.ps1` (Windows) scripts, creating two maintenance surfaces and constant divergence. The PAW approach eliminates this entirely:

| Approach                   | Maintenance Surfaces | Path Handling             | Encoding Issues      |
| -------------------------- | -------------------- | ------------------------- | -------------------- |
| Shell scripts (.sh + .ps1) | 2 per hook           | OS-specific               | CRLF vs LF           |
| **Pre-compiled .mjs**      | **1 per hook**       | **Node.js `path` module** | **UTF-8 everywhere** |

**The key insight**: `node .paw/hooks/xxx.mjs` runs identically on Windows PowerShell, cmd.exe, macOS bash, and Linux — one command string works everywhere. Hooks are authored in TypeScript but compiled to self-contained `.mjs` files via esbuild at build time. At runtime, only Node.js is needed — no tsx, no tsconfig, no TypeScript dependency.

**Prerequisites**: Node.js 18+.

Install PAW:

```bash
npm i -g paw-cli && paw init
```

---

## hooks.json — The Registration Layer

VS Code Copilot discovers hooks via `.github/hooks/hooks.json`. This file maps lifecycle events to commands.

### Schema

```jsonc
{
  "version": 1,
  "hooks": {
    "<eventName>": [
      {
        "type": "command",
        "bash": "<command>", // Unix shells
        "powershell": "<command>", // Windows PowerShell
        "cwd": ".", // Working directory (project root)
        "timeoutSec": 15, // Kill after N seconds
      },
    ],
  },
}
```

### Portability Trick

Because `node` is cross-platform and hooks are pre-compiled `.mjs`, **both fields use the identical command**:

```json
{
  "version": 1,
  "hooks": {
    "postToolUse": [
      {
        "type": "command",
        "bash": "node .paw/hooks/post-tool-use.mjs",
        "powershell": "node .paw/hooks/post-tool-use.mjs",
        "cwd": ".",
        "timeoutSec": 15
      }
    ]
  }
}
```

No branching. No platform detection. No runtime dependencies. One command.

### Available Hook Events

| Event                 | Fires When                    | Typical Use                                                              |
| --------------------- | ----------------------------- | ------------------------------------------------------------------------ |
| `userPromptSubmitted` | User sends a message          | Logging, L1 memory injection via `systemMessage`                         |
| `preToolUse`          | Agent is about to call a tool | Violation enforcement — deny tools until fixes applied                   |
| `postToolUse`         | Agent finishes a tool call    | Gate violations recorded in SQLite; PreToolUse enforces on the next call |
| `sessionEnd`          | Conversation ends             | Full health check, test gap detection, blocking gates                    |

Multiple hooks can register for the same event — they execute sequentially in array order.

### Merge-Not-Clobber

`pawSync.ts` generates `hooks.json` from discovered hooks in `.paw/hooks/`. When `hooks.json` already contains entries that don't belong to PAW (i.e. commands that don't reference `.paw/hooks/`), those entries are preserved. On each sync:

1. Existing `hooks.json` is read and parsed
2. Entries with commands containing `.paw/hooks/` are identified as PAW-managed and removed
3. Non-PAW entries are kept in their original position
4. New PAW entries are appended
5. The merged result is written

This means you can add custom non-PAW hooks to `hooks.json` and they won't be lost when running `paw sync`.

---

## Hook Runtime — The I/O Protocol

Every hook communicates with VS Code via **JSON over stdin/stdout**. Build a shared runtime module that all hooks import.

### HookResult Interface

```typescript
/**
 * Output shape accepted by Copilot hooks.
 * Aligned to VS Code chatHooks API v6 spec.
 */
export interface HookResult {
  /** Must be true to allow the agent to continue */
  continue: boolean;
  /** Visible message injected into the agent's conversation context */
  systemMessage?: string;
  /** Reason for stopping the agent (used with exit code 2) */
  stopReason?: string;
  /** Event-specific payload */
  hookSpecificOutput?: {
    /** Event name for routing */
    hookEventName: string;
    /** PreToolUse: 'allow' | 'ask' | 'deny' — controls tool permission */
    permissionDecision?: 'allow' | 'ask' | 'deny';
    /** Human-readable reason for permissionDecision */
    permissionDecisionReason?: string;
    /** PostToolUse / SessionEnd: 'block' | 'allow' */
    decision?: 'block' | 'allow';
    /** Human-readable reason for the decision */
    reason?: string;
  };
}
```

### Exit Code Semantics

| Exit Code | Meaning                              | Agent Behaviour                |
| --------- | ------------------------------------ | ------------------------------ |
| `0`       | Success — output is authoritative    | Agent reads hookSpecificOutput |
| `2`       | Blocking error — the hook is vetoing | Agent treats as hard block     |
| Other     | Non-blocking warning                 | Agent may ignore               |

Use `writeBlockingOutput()` helper to emit JSON + `process.exit(2)` atomically:

```typescript
export function writeBlockingOutput(result: HookResult): never {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(2);
}
```

### Reading Input

```typescript
/**
 * Read JSON hook payload from stdin with timeout fallback.
 */
export async function readHookInput(): Promise<Record<string, unknown>> {
  return await new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
    // Fallback: if stdin never closes, resolve with empty object
    setTimeout(() => resolve({}), 3000);
  });
}
```

The 3-second timeout is critical — some environments don't pipe stdin to hooks, and hanging would block the agent indefinitely.

### Writing Output

```typescript
/**
 * Emit hook result as single-line JSON to stdout.
 */
export function writeHookOutput(result: HookResult): void {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
```

### File Path Resolution

Tools send file paths in various payload shapes. Build a resilient resolver:

```typescript
/**
 * Extract the edited file path from hook input.
 * Handles multiple payload structures from different tool sources.
 */
export function resolveEditedFilePath(
  hookInput: Record<string, unknown>,
): string | undefined {
  const candidates: string[] = [];

  // Direct path
  if (typeof hookInput.filePath === 'string')
    candidates.push(hookInput.filePath);

  // Nested in toolInput
  const toolInput = hookInput.toolInput as Record<string, unknown> | undefined;
  if (toolInput) {
    for (const key of ['path', 'filePath', 'file_path']) {
      if (typeof toolInput[key] === 'string')
        candidates.push(toolInput[key] as string);
    }
  }

  // Nested in toolArgs (may be stringified JSON)
  let parsedArgs: Record<string, unknown> = {};
  if (typeof hookInput.toolArgs === 'string') {
    try {
      parsedArgs = JSON.parse(hookInput.toolArgs);
    } catch {
      /* empty */
    }
  } else if (
    typeof hookInput.toolArgs === 'object' &&
    hookInput.toolArgs !== null
  ) {
    parsedArgs = hookInput.toolArgs as Record<string, unknown>;
  }
  for (const key of ['filePath', 'file_path']) {
    if (typeof parsedArgs[key] === 'string')
      candidates.push(parsedArgs[key] as string);
  }

  // CLI fallback
  return candidates.find((v) => v.trim().length > 0) ?? process.argv[2];
}
```

### Re-Entry Guard

Session-end hooks can trigger tool use, which triggers more hooks. Prevent infinite loops:

```typescript
/**
 * Detect nested hook execution to prevent re-entry loops.
 */
export function isNestedHookRun(hookInput: Record<string, unknown>): boolean {
  return (
    hookInput.stop_hook_active === true ||
    hookInput.session_end_hook_active === true ||
    hookInput.sessionEnd_hook_active === true
  );
}
```

Every session-end hook should check this at entry and short-circuit:

```typescript
const input = await readHookInput();
if (isNestedHookRun(input)) {
  writeHookOutput({ continue: true });
  return;
}
```

---

## Implementing the Three Hook Types

### 1. userPromptSubmitted — Lightweight Logging & Validation

This hook fires on every user message. Keep it fast (< 2 seconds).

```typescript
import { readHookInput, writeHookOutput } from './hook-runtime';
import { appendFileSync, mkdirSync } from 'node:fs';

async function main(): Promise<void> {
  const input = await readHookInput();
  const sessionId = input.sessionId ?? 'unknown';
  const timestamp = new Date().toISOString();

  // Append to log file
  const logDir = '.github/hooks';
  mkdirSync(logDir, { recursive: true });
  appendFileSync(
    `${logDir}/hooks.log`,
    `${timestamp} userPromptSubmitted ${sessionId}\n`,
  );

  writeHookOutput({ continue: true });
}

main().catch(() => writeHookOutput({ continue: true }));
```

**Extension points**: Validate prompt structure, detect task keywords, pre-load skills.

### 2. preToolUse — Violation Enforcement Gate

This hook fires **before** a tool executes. It reads the violation ledger written by `postToolUse` and denies non-remediation tools until violations are fixed.

```typescript
import { existsSync, readFileSync } from 'node:fs';
import {
  readHookInput,
  writeHookOutput,
  writeBlockingOutput,
} from './hook-runtime';
import { VIOLATIONS_PATH } from './paw-paths';

const EXEMPT_TOOLS = new Set([
  'read_file',
  'grep_search',
  'file_search',
  'semantic_search',
  'list_dir',
  'get_errors',
  'memory',
  'manage_todo_list',
]);

async function main(): Promise<void> {
  const input = await readHookInput();
  const toolName = typeof input.toolName === 'string' ? input.toolName : '';

  if (EXEMPT_TOOLS.has(toolName)) {
    writeHookOutput({ continue: true });
    return;
  }

  if (!existsSync(VIOLATIONS_PATH)) {
    writeHookOutput({ continue: true });
    return;
  }

  const ledger = JSON.parse(readFileSync(VIOLATIONS_PATH, 'utf-8'));
  // Also allow re-edits of the violated file itself
  if (isFixingViolatedFile(input, ledger.file)) {
    writeHookOutput({ continue: true });
    return;
  }

  writeBlockingOutput({
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'preToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Outstanding violations in ${ledger.file}`,
    },
    systemMessage: `Fix violations in ${ledger.file} before using other tools.`,
  });
}
```

**Key**: `permissionDecision: 'deny'` + exit code 2 is the VS Code spec mechanism for blocking tool execution.

### 3. postToolUse — Blocking Lint on Every Edit

This hook fires after every tool call. It runs fast regex checks on edited files and **blocks with enforcement** when violations are found. Writes a violation ledger that `preToolUse` reads.

```typescript
import { writeFileSync, renameSync, unlinkSync } from 'node:fs';
import {
  readHookInput,
  writeHookOutput,
  writeBlockingOutput,
} from './hook-runtime';
import { VIOLATIONS_PATH, PAW_DIR } from './paw-paths';

async function main(): Promise<void> {
  const input = await readHookInput();
  const filePath = resolveEditedFilePath(input);
  // ... run checks, collect warnings ...

  if (warnings.length > 0) {
    // Write violation ledger to paw.sqlite for preToolUse to read
    insertViolations(filePath, warnings, sessionId);
    // PostToolUse CANNOT deny tools — only inject advisory context.
    // PreToolUse reads SQLite and issues the actual denial on the next call.
    writeHookOutput({
      continue: true,
      decision: 'block',
      reason: `${warnings.length} violation(s) detected`,
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `⚠️ Gate violations in ${filePath}:\n${warnings.join('\n')}\n\nFix these before continuing.`,
      },
    });
  } else {
    // Clear any previous violations for this file
    clearViolations(filePath, sessionId);
    writeHookOutput({ continue: true });
  }
}
```

**Enforcement loop**:

1. `postToolUse` detects violations → writes findings to `paw.sqlite` → emits advisory `decision:'block'` context (does NOT stop execution — PostToolUse cannot deny tools per the VS Code spec)
2. `preToolUse` queries SQLite for unresolved violations → **denies** non-exempt tools until the violated file is fixed
3. Agent fixes the file → `postToolUse` re-runs gates → resolves violations in SQLite
4. `preToolUse` sees no unresolved violations → allows all tools again

**Design rules for postToolUse hooks**:

- **Record violations into SQLite** + emit advisory `decision: 'block'` context (exit code 0 — PostToolUse cannot stop execution per VS Code spec)
- **Never use `writeBlockingOutput`** in postToolUse — that is only valid for PreToolUse and sessionEnd
- **Direct regex only** — no file enumeration, no subprocess calls
- **No network** — must work offline
- **Fail open** — catch-all returns `{ continue: true }`

### 3. sessionEnd — Blocking Quality Gates

Session-end hooks can **block** the session from closing, forcing the agent to remediate. Use this for comprehensive checks.

```typescript
import { execSync } from 'node:child_process';
import {
  readHookInput,
  writeHookOutput,
  isNestedHookRun,
} from './hook-runtime';

async function main(): Promise<void> {
  const input = await readHookInput();
  if (isNestedHookRun(input)) {
    writeHookOutput({ continue: true });
    return;
  }

  // Check if source files changed
  if (!hasSourceChanges()) {
    writeHookOutput({ continue: true });
    return;
  }

  // Run the health check in diff-scoped mode
  let output = '';
  let exitCode = 0;
  try {
    output = execSync('node .paw/hooks/session-end-health.mjs --changed-only', {
      encoding: 'utf-8',
      timeout: 90000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; status?: number };
    output = execErr.stdout ?? '';
    exitCode = execErr.status ?? 1;
  }

  // Parse the JSON report from stdout markers
  const report = parseJsonReport(output);

  if (report?.summary?.has_critical) {
    writeBlockingOutput({
      continue: true,
      systemMessage: buildActionableContext(report),
      hookSpecificOutput: {
        hookEventName: 'sessionEnd',
        decision: 'block',
        reason: 'Critical health check violations in changed files',
      },
    });
  } else {
    writeHookOutput({ continue: true });
  }
}
```

**Design rules for sessionEnd hooks**:

- **Always check re-entry** (`isNestedHookRun`)
- **Scope to changed files** — don't let pre-existing debt block sessions
- **Set generous timeouts** (60–120 seconds)
- **Use `decision: 'block'`** only for critical, fixable issues
- **Provide actionable context** via `systemMessage` — tell the agent exactly what to fix
- **Use exit code 2** for blocking decisions — `writeBlockingOutput()` handles this

---

## Cross-Platform Patterns Reference

| Concern              | Pattern                                                                                |
| -------------------- | -------------------------------------------------------------------------------------- |
| Path separators      | `filePath.replace(/\\/g, '/')` — normalize to forward slashes early                    |
| File operations      | `fs.promises` or `fs` sync variants — both cross-platform                              |
| Subprocess execution | `execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'] })` — explicit pipes avoid TTY issues |
| Git commands         | `execSync('git ...')` — works anywhere git is installed                                |
| Hook execution       | `node .paw/hooks/xxx.mjs` — pre-compiled, identical on all platforms                   |
| Temp files           | `os.tmpdir()` — though prefer in-memory processing                                     |
| Timeouts             | Always set `setTimeout` fallbacks on stdin reads                                       |

---

## Build: Compiling Hooks

Hooks are authored in TypeScript but compiled to `.mjs` via esbuild. Run `node build.mjs` to produce `dist/` with the CLI and compiled hooks. The compiled `.mjs` files are self-contained — no tsconfig or tsx needed at runtime.

For development, you can still use a `tsconfig.scripts.json` at project root:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "noEmit": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "strict": true,
    "jsx": "react-jsx"
  },
  "include": ["scripts/**/*.ts", ".github/scripts/**/*.ts"]
}
```

**Key choices**:

- `ES2022` target — enables top-level await, import.meta
- `ESNext` modules — native ESM, no CommonJS translation
- `noEmit` — type checking only; esbuild handles compilation
- `bundler` resolution — handles both bare specifiers and relative paths

---

## Directory Layout

```
.github/
  hooks/
    hooks.json              ← Registration layer (VS Code reads this)
  PAW/
    hook-runtime.ts         ← Shared I/O protocol (HookResult, writeBlockingOutput)
    paw-paths.ts            ← Central path constants (VIOLATIONS_PATH, etc.)
    hooks/                  ← Default hook source (compiled to .mjs by build)
      pre-tool-use.ts
      user-prompt-submitted.ts
      post-tool-use.ts
      session-end-memory-save.ts
      session-end-health.ts
      session-end-missing-tests.ts
    pawGates.ts             ← Gate orchestrator (see Part 2)
    gates/                  ← Drop .gate.ts files here
    paw.db                  ← SQLite memory store (gitignored)

.paw/                       ← Project-specific overrides (gitignored)
  hooks/                    ← Active compiled hooks (*.mjs — VS Code executes these)
  violations.json           ← Violation ledger (postToolUse writes, preToolUse reads)
```

---

## Memory Integration

Hooks are the I/O layer for PAW's persistent memory store. Two hooks interact with `paw.db`:

| Hook        | Event                 | Direction | Purpose                                                        |
| ----------- | --------------------- | --------- | -------------------------------------------------------------- |
| L1 loader   | `userPromptSubmitted` | Read      | Query recent decisions + patterns → inject via `systemMessage` |
| Memory save | `sessionEnd`          | Write     | Persist new decisions, bump pattern counts, save agent hints   |

The memory save hook runs **first** in the `sessionEnd` array so downstream hooks (like the health gate) can reference the freshest data.

See [Part 7: Agent Memory Model](./07-agent-memory-model.md) for the full schema, tiered loading protocol, and federation.

---

## Next: [Part 2 — QualityGate Architecture](./02-quality-gate-architecture.md)
