# Part 2: QualityGate Architecture

> Drop a `.gate.ts` file into `.github/PAW/gates/` — PAW handles the rest.

---

## Filesystem Convention

PAW's quality gate system is entirely filesystem-driven. The orchestrator (`pawGates.ts`) lives in `.github/PAW/` and discovers gates from `.paw/gates/`:

```
.github/PAW/
  pawGates.ts                    ← Orchestrator script (run via paw gates)
  health-check-types.ts          ← Shared type definitions

.paw/gates/
  file-length.gate.ts            ← Each file = one gate
  duplicate-css.gate.ts
  jsdoc-quality.gate.ts
  antipatterns.gate.ts
  test-gaps.gate.ts
  content-format.gate.ts
  {custom}.gate.ts               ← TypeScript gates (in-process import)
  {custom}.gate.py               ← Python gates (subprocess, if runner configured)
  {custom}.gate.js               ← Node.js gates (subprocess, if runner configured)
```

No registration, no arrays — if a file matches a configured runner suffix and (for TypeScript) exports a `gate` constant, it's part of the system. Configure runners in `.paw/config.json` under the `runners` key.

### How It's Invoked

Hooks and npm scripts call gates via the `paw` CLI:

```bash
# Run specific gates by name
paw gates --gates file-length,antipatterns

# Run all gates
paw gates

# Run all gates, scoped to changed files
paw gates --changed-only

# Run gates in a port
paw gates --port code-quality
```

From hooks, the invocation looks like any other `execSync` call:

```typescript
const output = execSync(
  'paw gates --gates file-length,antipatterns --changed-only',
  { encoding: 'utf-8', timeout: 90000, stdio: ['pipe', 'pipe', 'pipe'] },
);
```

From `package.json`:

```json
{
  "scripts": {
    "health:check": "paw gates",
    "health:check:changed": "paw gates --changed-only"
  }
}
```

---

## The Problem with Static Check Arrays

A common first-generation health check system looks like this:

```typescript
const CHECKS: CheckEntry[] = [
  { name: 'file-length', run: checkFileLength },
  { name: 'duplicate-css', run: checkDuplicateCss },
  { name: 'jsdoc-quality', run: checkJsdocQuality },
  { name: 'antipatterns', run: checkAntipatterns },
  { name: 'test-gaps', run: checkTestGaps },
  { name: 'mdx-format', run: checkMdxFormat },
];
```

This works, but has structural problems:

1. **Adding a check requires editing the orchestrator** — violates Open/Closed Principle
2. **No logical grouping** — all checks are peers regardless of domain
3. **Post-hoc filtering** — the orchestrator runs everything, then filters to changed files after the fact
4. **No dependency ordering** — checks can't declare "run me after X"
5. **No conditional execution** — a CSS check still initializes for a TypeScript-only change

The QualityGate adapter pattern solves all five.

---

## Core Interfaces

### QualityGate — The Adapter

Every check implements this single interface:

```typescript
/**
 * A single quality check.
 * Implementations are auto-discovered from .github/PAW/gates/.
 */
export interface QualityGate {
  /** Unique identifier (kebab-case, e.g. 'file-length') */
  readonly id: string;

  /** Human-readable display name */
  readonly name: string;

  /** Logical port this gate belongs to */
  readonly port: GatePort;

  /** Base severity when this gate fails */
  readonly severity: 'critical' | 'warning';

  /** File extensions this gate cares about (e.g. ['.ts', '.tsx']) */
  readonly appliesTo: string[];

  /** Optional: gates that must run before this one */
  readonly dependsOn?: string[];

  /**
   * Execute the check against the provided context.
   * Return a result with pass/fail status and any findings.
   */
  check(context: GateContext): Promise<GateResult>;
}
```

### GatePort — Logical Groupings

Gates register into named ports. Ports are logical, not physical — they're just tags for grouping and selective execution.

```typescript
/**
 * Logical grouping for quality gates.
 * Ports enable running subsets of checks (e.g. only 'code-quality' gates).
 */
export type GatePort =
  | 'code-quality' // Style, complexity, anti-patterns
  | 'content-structure' // MDX format, naming, required fields
  | 'test-coverage' // Test file existence, coverage thresholds
  | 'build-integrity' // File length, duplicate definitions, imports
  | 'custom'; // User-defined gates
```

### GateContext — Scoped Execution Environment

Instead of post-filtering, the orchestrator builds a context that gates use to self-scope:

```typescript
/**
 * Execution context passed to every gate.
 * Contains pre-resolved file lists, mode flags, and git state.
 */
export interface GateContext {
  /** Project root absolute path */
  readonly rootDir: string;

  /** 'full' scans everything; 'changed-only' scopes to modified files */
  readonly mode: 'full' | 'changed-only';

  /** Changed file paths (relative to root), null in 'full' mode */
  readonly changedFiles: ReadonlySet<string> | null;

  /**
   * Get files to check, respecting mode and the gate's appliesTo filter.
   * In 'full' mode: walks the project tree filtered by extensions.
   * In 'changed-only' mode: intersects changedFiles with appliesTo.
   */
  targetFiles(appliesTo: string[]): Promise<string[]>;

  /**
   * Read a file's content. Cached across gates to avoid redundant I/O.
   */
  readFile(relativePath: string): Promise<string>;

  /**
   * Execute a git command relative to rootDir. Returns stdout.
   */
  git(command: string): string;
}
```

The `targetFiles()` method is the key innovation — gates declare what they care about and the context handles scoping:

```typescript
// Inside a gate implementation:
async check(context: GateContext): Promise<GateResult> {
  const files = await context.targetFiles(this.appliesTo); // ['.ts', '.tsx']
  // 'files' is already filtered to changed .ts/.tsx files in diff mode
  // or all .ts/.tsx files in full mode
}
```

### GateResult — Unified Output

```typescript
/**
 * Output from a single gate execution.
 */
export interface GateResult {
  /** Gate identifier */
  gate: string;

  /** True if no violations found */
  passed: boolean;

  /** Effective severity (may differ from gate default if mixed) */
  severity: 'critical' | 'warning' | 'info';

  /** Individual violations */
  findings: GateFinding[];

  /** Execution statistics */
  stats: GateStats;
}

/**
 * A single violation found by a gate.
 */
export interface GateFinding {
  /** File path relative to project root */
  file: string;

  /** Line number (1-based), if applicable */
  line?: number;

  /** Rule identifier within this gate */
  rule: string;

  /** Human-readable violation description */
  message: string;

  /** Actionable fix suggestion */
  suggestion?: string;

  /** Per-finding severity override */
  severity?: 'critical' | 'warning';
}

/**
 * Execution statistics for a gate run.
 */
export interface GateStats {
  /** Number of files examined */
  filesChecked: number;

  /** Number of findings */
  findingsCount: number;

  /** Execution time in milliseconds */
  durationMs: number;

  /** Gate-specific counters */
  [key: string]: number;
}
```

### HealthReport — Aggregated Output

```typescript
/**
 * Top-level report produced by the HealthOrchestrator.
 */
export interface HealthReport {
  /** ISO timestamp of the run */
  timestamp: string;

  /** 'full' or 'changed-only' */
  mode: 'full' | 'changed-only';

  /** Changed file list when mode is 'changed-only', otherwise null */
  changedFiles: string[] | null;

  /** 'PASS' or 'FAIL' */
  overall: 'PASS' | 'FAIL';

  /** Aggregate counters */
  summary: {
    totalGates: number;
    passed: number;
    failed: number;
    totalFindings: number;
    hasCritical: boolean;
  };

  /** Per-gate results */
  gates: GateResult[];
}
```

---

## pawGates.ts — The Orchestrator

`pawGates.ts` discovers gates from `.paw/gates/`, resolves dependencies, builds context, and runs everything.

### Auto-Discovery

Gates are discovered by filesystem convention from `.paw/gates/`. Any file matching a configured runner suffix (default: `.gate.ts`) that exports a `gate` constant is registered automatically. When `--gates name,name` is passed, only those gates run.

```typescript
// .paw/gates/file-length.gate.ts
import type {
  QualityGate,
  GateContext,
  GateResult,
} from '../../.github/PAW/health-check-types';

export const gate: QualityGate = {
  id: 'file-length',
  name: 'File Length',
  port: 'build-integrity',
  severity: 'critical',
  appliesTo: ['.ts', '.tsx', '.mjs', '.scss'],

  async check(context: GateContext): Promise<GateResult> {
    const files = await context.targetFiles(this.appliesTo);
    const findings: GateFinding[] = [];
    const MAX_LINES = 250;

    for (const file of files) {
      const content = await context.readFile(file);
      const lineCount = content.split('\n').length;
      if (lineCount > MAX_LINES) {
        findings.push({
          file,
          rule: 'max-lines',
          message: `File has ${lineCount} lines (max: ${MAX_LINES})`,
          suggestion:
            'Split into smaller modules or add to allowlist with justification',
          severity: 'critical',
        });
      }
    }

    return {
      gate: this.id,
      passed: findings.length === 0,
      severity: findings.length > 0 ? this.severity : 'info',
      findings,
      stats: {
        filesChecked: files.length,
        findingsCount: findings.length,
        durationMs: 0,
      },
    };
  },
};
```

### Discovery Mechanism

Gate discovery matches files in `.paw/gates/` against configured runner suffixes. The default configuration only recognises `.gate.ts`; additional suffixes are added via the `runners` key in `.paw/config.json`.

#### Runner Configuration

```jsonc
// .paw/config.json
{
  "runners": {
    ".gate.ts": "import", // In-process dynamic import (fast, default)
    ".gate.js": "node", // Node.js subprocess
    ".gate.py": "python3", // Python subprocess
    ".gate.sh": "bash", // Shell subprocess
  },
}
```

When no `runners` key is present, the default `{ ".gate.ts": "import" }` is used — preserving backward compatibility.

#### TypeScript Gates (In-Process)

TypeScript gates with `"import"` runner are loaded via dynamic `import()` and must export a `gate` constant implementing `QualityGate`. This is the fastest path — no subprocess overhead.

#### Subprocess Gates (Any Language)

Gates with any other runner value are executed as subprocesses. The protocol:

1. **Spawn**: `{runner} {gatePath}` (e.g. `python3 .paw/gates/custom.gate.py`)
2. **stdin**: JSON object with `rootDir`, `mode`, and `changedFiles`
3. **stdout**: JSON `GateResult` (same schema as TypeScript gates)

```json
// stdin payload
{
  "rootDir": "/path/to/project",
  "mode": "changed-only",
  "changedFiles": ["src/foo.ts", "src/bar.scss"]
}
```

The subprocess is responsible for its own file walking and scoping. It must write a valid `GateResult` JSON to stdout and exit with code 0.

#### Discovery Code

```typescript
const runners = loadRunnerConfig(); // from .paw/config.json or DEFAULT_RUNNERS
const allFiles = readdirSync(GATES_DIR).filter(
  (f) => matchRunner(f, runners) !== null,
);

for (const file of files) {
  const suffix = matchRunner(file, runners)!;
  const runnerCmd = runners[suffix];

  if (runnerCmd === 'import') {
    // Fast in-process path for TypeScript gates
    const mod = await import(pathToFileURL(path.join(GATES_DIR, file)).href);
    if (mod.gate && typeof mod.gate.check === 'function') {
      gates.push(mod.gate);
    }
  } else {
    // Subprocess path for any other language
    gates.push({
      id: file.replace(/\.gate\.\w+$/, ''),
      name: file.replace(/\.gate\.\w+$/, ''),
      port: 'custom',
      severity: 'critical',
      appliesTo: [],
      async check(context) {
        return runSubprocessGate(runnerCmd, gatePath, context);
      },
    });
  }
}
```

### Dependency Resolution

Gates can declare `dependsOn: ['other-gate-id']`. The orchestrator topologically sorts before execution:

```typescript
/**
 * Topological sort of gates by dependsOn declarations.
 * Throws if a cycle is detected.
 */
function resolveExecutionOrder(gates: QualityGate[]): QualityGate[] {
  const byId = new Map(gates.map((g) => [g.id, g]));
  const visited = new Set<string>();
  const sorted: QualityGate[] = [];
  const visiting = new Set<string>();

  function visit(gate: QualityGate): void {
    if (visited.has(gate.id)) return;
    if (visiting.has(gate.id)) throw new Error(`Cycle detected: ${gate.id}`);
    visiting.add(gate.id);
    for (const depId of gate.dependsOn ?? []) {
      const dep = byId.get(depId);
      if (dep) visit(dep);
    }
    visiting.delete(gate.id);
    visited.add(gate.id);
    sorted.push(gate);
  }

  for (const gate of gates) visit(gate);
  return sorted;
}
```

### Context Builder

```typescript
/**
 * Build a GateContext from CLI flags and git state.
 */
async function buildContext(
  rootDir: string,
  mode: 'full' | 'changed-only',
): Promise<GateContext> {
  const changedFiles =
    mode === 'changed-only' ? getChangedFiles(rootDir) : null;
  const fileCache = new Map<string, string>();

  return {
    rootDir,
    mode,
    changedFiles,

    async targetFiles(appliesTo: string[]): Promise<string[]> {
      if (mode === 'changed-only' && changedFiles) {
        return [...changedFiles].filter((f) =>
          appliesTo.some((ext) => f.endsWith(ext)),
        );
      }
      // Full mode: walk project tree (implementation varies by project)
      return walkProject(rootDir, appliesTo);
    },

    async readFile(relativePath: string): Promise<string> {
      if (!fileCache.has(relativePath)) {
        const content = await fs.readFile(
          path.join(rootDir, relativePath),
          'utf-8',
        );
        fileCache.set(relativePath, content);
      }
      return fileCache.get(relativePath)!;
    },

    git(command: string): string {
      return execSync(`git ${command}`, {
        cwd: rootDir,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    },
  };
}
```

### Execution & Reporting

```typescript
/**
 * Run discovered gates and produce a HealthReport.
 * Called by pawGates.ts main() after parsing CLI args.
 */
async function orchestrate(
  rootDir: string,
  mode: 'full' | 'changed-only',
  gateNames?: string[],
): Promise<HealthReport> {
  const gates = await discoverGates(gateNames);
  const ordered = resolveExecutionOrder(gates);
  const context = await buildContext(rootDir, mode);
  const results: GateResult[] = [];
  let hasCritical = false;

  for (const gate of ordered) {
    const start = performance.now();
    try {
      const result = await gate.check(context);
      result.stats.durationMs = Math.round(performance.now() - start);
      results.push(result);
      if (!result.passed && result.severity === 'critical') hasCritical = true;
    } catch (err) {
      results.push({
        gate: gate.id,
        passed: false,
        severity: 'critical',
        findings: [{ file: gate.id, rule: 'gate-error', message: String(err) }],
        stats: {
          filesChecked: 0,
          findingsCount: 1,
          durationMs: Math.round(performance.now() - start),
        },
      });
      hasCritical = true;
    }
  }

  return {
    timestamp: new Date().toISOString(),
    mode,
    changedFiles: context.changedFiles ? [...context.changedFiles] : null,
    overall: hasCritical ? 'FAIL' : 'PASS',
    summary: {
      totalGates: results.length,
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed).length,
      totalFindings: results.reduce((sum, r) => sum + r.findings.length, 0),
      hasCritical,
    },
    gates: results,
  };
}
```

### Output Format

The orchestrator emits both human-readable console output and a machine-readable JSON report:

```
🩺 Running Health Check (diff-scoped: 5 file(s))...

  ⏳ file-length... ✅ PASS
  ⏳ antipatterns... ❌ FAIL (2 issue(s))
  ⏳ test-gaps... ✅ PASS

────────────────────────────────────────────────────
📊 Overall: FAIL
   Gates: 2/3 passed
   Findings: 2

---JSON_REPORT_START---
{ ... full JSON report ... }
---JSON_REPORT_END---
```

The `---JSON_REPORT_START---` / `---JSON_REPORT_END---` markers enable reliable parsing by hooks and CI systems.

---

## Adding a Custom Gate — Step by Step

### 1. Create the Gate File

```typescript
// .github/PAW/gates/no-todo.gate.ts
import type {
  QualityGate,
  GateContext,
  GateResult,
  GateFinding,
} from '../health-check-types';

export const gate: QualityGate = {
  id: 'no-todo',
  name: 'No Unformatted TODOs',
  port: 'code-quality',
  severity: 'warning',
  appliesTo: ['.ts', '.tsx'],

  async check(context: GateContext): Promise<GateResult> {
    const files = await context.targetFiles(this.appliesTo);
    const findings: GateFinding[] = [];

    for (const file of files) {
      const content = await context.readFile(file);
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/\/\/\s*TODO(?!:)/.test(lines[i])) {
          findings.push({
            file,
            line: i + 1,
            rule: 'todo-format',
            message: 'Unformatted TODO — use "TODO: description" format',
            suggestion: 'Add a colon and description after TODO',
          });
        }
      }
    }

    return {
      gate: this.id,
      passed: findings.length === 0,
      severity: findings.length > 0 ? this.severity : 'info',
      findings,
      stats: {
        filesChecked: files.length,
        findingsCount: findings.length,
        durationMs: 0,
      },
    };
  },
};
```

### 2. Done

That's it. The orchestrator auto-discovers it on the next run. No imports to add, no arrays to edit.

### 3. Optional: Run Only Your Port

```bash
paw gates --port code-quality
```

---

## Port-Selective Execution

The orchestrator supports filtering by port — useful for fast feedback loops during development:

```typescript
const portFilter = parsePortArg(process.argv); // --port code-quality

const gates = (await discoverGates(gateNames)).filter(
  (g) => !portFilter || g.port === portFilter,
);
```

Common patterns:

| Command                                           | Runs                                 |
| ------------------------------------------------- | ------------------------------------ |
| `pawGates.ts`                                     | All gates                            |
| `pawGates.ts --changed-only`                      | All gates, scoped to changed files   |
| `pawGates.ts --gates file-length,antipatterns`    | Only named gates                     |
| `pawGates.ts --port code-quality`                 | Only code-quality port gates         |
| `pawGates.ts --port test-coverage --changed-only` | Test coverage gates on changed files |
| `pawGates.ts --gates memory-drift --changed-only` | Single gate, scoped to changes       |

---

## Comparison: Before & After

| Aspect          | Static CHECKS Array                | QualityGate Adapters                      |
| --------------- | ---------------------------------- | ----------------------------------------- |
| Adding a check  | Edit orchestrator, add import      | Drop a `.gate.ts` file into `PAW/gates/`  |
| Grouping        | Flat list                          | Named ports                               |
| File scoping    | Post-filter by orchestrator        | Self-scoped via `context.targetFiles()`   |
| Dependencies    | None                               | `dependsOn` with topological sort         |
| Selective runs  | Not supported                      | `--gates name,name` and `--port` flags    |
| File I/O        | Each check reads independently     | Shared cache via `context.readFile()`     |
| Error isolation | Check crash may crash orchestrator | Try/catch per gate with error placeholder |

---

## Gate Ignore Directives

To suppress a finding inline, add a `paw:gate:` directive to the source file.
These are processed by the PAW orchestrator in `gate-ignore.ts` after `gate.check()` returns —
gates themselves require no changes.

### Syntax

| Directive                                    | Scope                                        |
| -------------------------------------------- | -------------------------------------------- |
| `/* paw:gate:{id} ignore */`                 | All rules for that gate, whole file          |
| `/* paw:gate:{id}:{rule} ignore */`          | One rule for that gate, whole file           |
| `/* paw:gate:{id} ignore-nextline */`        | All rules, next line only                    |
| `/* paw:gate:{id}:{rule} ignore-nextline */` | One rule, next line only                     |
| `/* paw:gate:* ignore */`                    | ALL gates, whole file (generated files only) |

Also valid in MDX JSX comments `{/* … */}` and HTML comments `<!-- … -->`.

### Examples

```ts
/* paw:gate:* ignore */
// Generated file header — suppresses every gate
export const mdxComponents = {};
```

```ts
/* paw:gate:antipatterns:console-log ignore */
// Test runner — console.log is intentional
```

```mdx
{/* paw:gate:content-format:missing-h1 ignore */}
```

### How It Works

`gate-ignore.ts` (`.github/PAW/gate-ignore.ts`) exports `filterGateFindings()`. The orchestrator
calls it after every `gate.check()` and before writing `result.passed`:

```typescript
result.findings = await filterGateFindings(gate.id, result.findings, (rel) =>
  context.readFile(rel),
);
result.passed = result.findings.length === 0;
```

Each unique file is read once (backed by `context.readFile` cache). The parser handles
all three comment styles and is case-insensitive for gate and rule IDs.

### Rules

- Use the narrowest scope possible: `gate:rule` over `gate:*`, `ignore-nextline` over `ignore`.
- `paw:gate:* ignore` is reserved for generated/auto-emitted files only.
- Never suppress `missing-test` — create the test file instead.
- `health:check-ignore` (legacy) is deprecated and no longer parsed by the gate system.

---

## Memory-Aware Gates

Gates can read from `paw.db` to make smarter decisions. The **drift detection gate** (`memory-drift.gate.ts`) compares local active decisions against imported (federated) decisions and flags contradictions as warnings.

This gate uses the `custom` port and `warning` severity — it never blocks, just surfaces potential inconsistencies for human review.

Gates can also **write** pattern data back through the session-end save hook. For example, a gate that consistently passes for a domain can increment that domain's "healthy" pattern count, giving agents confidence in established conventions.

See [Part 7: Agent Memory Model](./07-agent-memory-model.md) for the full drift detection gate implementation and federation model.

---

## Next: [Part 3 — Agent Ecosystem](./03-agent-ecosystem.md)
