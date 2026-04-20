# Part 7: Agent Memory Model

> A local-first SQLite memory store that gives agents persistent context across sessions — with optional federation for team-scale knowledge sharing.

---

## Why Agents Need Memory

Without persistent memory, every agent session starts cold. The Analyzer re-reads the same architecture docs, the Implementer re-discovers the same patterns, and the HealthReviewer re-learns which warnings are accepted. This wastes tokens, time, and occasionally leads to contradictory decisions.

PAW's memory model solves this with three principles:

1. **Personal first** — each developer's PAW instance owns its own SQLite database, optimized for fast local reads
2. **Tiered loading** — agents wake up with minimal context and pull more only when needed
3. **Federation optional** — teams can share knowledge across instances via pull-only remotes, but the system works fully standalone

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Agent Session                        │
│                                                         │
│  L0: Identity (~50 tokens)                              │
│  ├── agent name, phase, constraints                     │
│                                                         │
│  L1: Critical Facts (~200 tokens)                       │
│  ├── queried from paw.db by hook at session start       │
│  ├── recent decisions, known patterns, agent hints      │
│                                                         │
│  L2: Domain Context (on-demand)                         │
│  └── full skill files, instruction files, task history  │
│      loaded only when the agent's task requires it      │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  Session-End Save Hook                                  │
│  └── INSERTs findings, decisions, hints into paw.db     │
├─────────────────────────────────────────────────────────┤
│                      paw.db                             │
│  ┌────────────┐ ┌──────────┐ ┌──────────────┐          │
│  │ decisions   │ │ patterns │ │ agent_memory │          │
│  └────────────┘ └──────────┘ └──────────────┘          │
│  ┌────────────┐                                         │
│  │ task_index  │                                        │
│  └────────────┘                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Tiered Agent Loading Protocol

Agents don't need everything at once. PAW loads context in three tiers, keeping early token costs near zero.

### L0 — Identity (Always Loaded)

The agent's `.agent.md` file. This is already loaded by VS Code Copilot as part of agent invocation. No PAW action needed.

**Contents**: Name, mission statement, tool list, phase position, hard constraints.
**Token cost**: ~50 tokens.

### L1 — Critical Facts (Hook-Injected)

A `userPromptSubmitted` hook queries `paw.db` and injects a compact summary into the agent's context via `additionalContext`.

**Contents**:

- Last 3–5 decisions relevant to the current working directory
- Top patterns (highest occurrence count) for the agent's domain
- Agent-specific hints from prior sessions (e.g., "this project uses barrel exports")
- Active task reference (if resuming work)

**Token cost**: ~200 tokens (hard cap enforced by the hook).

```typescript
import Database from 'better-sqlite3';
import { readHookInput, writeHookOutput } from './hook-runtime';

const MAX_L1_CHARS = 800;

async function main(): Promise<void> {
  const input = await readHookInput();

  const db = new Database('.github/PAW/paw.db', { readonly: true });
  const facts: string[] = [];

  // Recent decisions (not superseded)
  const decisions = db
    .prepare(
      `
    SELECT context, choice, rationale
    FROM decisions
    WHERE superseded_at IS NULL
    ORDER BY valid_from DESC
    LIMIT 5
  `,
    )
    .all() as Array<{ context: string; choice: string; rationale: string }>;

  for (const d of decisions) {
    facts.push(`Decision: ${d.context} → ${d.choice} (${d.rationale})`);
  }

  // Top patterns
  const patterns = db
    .prepare(
      `
    SELECT name, description, occurrences
    FROM patterns
    WHERE occurrences >= 3
    ORDER BY occurrences DESC
    LIMIT 5
  `,
    )
    .all() as Array<{ name: string; description: string; occurrences: number }>;

  for (const p of patterns) {
    facts.push(`Pattern (${p.occurrences}x): ${p.name} — ${p.description}`);
  }

  // Agent hints
  const agentName = (input.agentName as string) ?? 'unknown';
  const hints = db
    .prepare(
      `
    SELECT hint
    FROM agent_memory
    WHERE agent = ?
    ORDER BY updated_at DESC
    LIMIT 3
  `,
    )
    .all(agentName) as Array<{ hint: string }>;

  for (const h of hints) {
    facts.push(`Hint: ${h.hint}`);
  }

  db.close();

  // Enforce token budget
  let context = facts.join('\n');
  if (context.length > MAX_L1_CHARS) {
    context = context.slice(0, MAX_L1_CHARS) + '\n[truncated]';
  }

  if (context.length > 0) {
    writeHookOutput({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'userPromptSubmitted',
        additionalContext: `## PAW Memory (L1)\n${context}`,
      },
    });
  } else {
    writeHookOutput({ continue: true });
  }
}

main().catch(() => writeHookOutput({ continue: true }));
```

### L2 — Domain Context (On-Demand)

Full skill files, instruction files, architecture docs, and task history. Loaded by the agent itself when it identifies which domains the task touches — this is already how agents work in Parts 3–4. PAW doesn't change this layer, just provides better indexing for what to load.

The `task_index` table enables quick lookups:

```sql
SELECT file_path, summary
FROM task_index
WHERE domain = 'styling'
ORDER BY created_at DESC
LIMIT 3;
```

---

## SQLite Schema

PAW uses a single `paw.db` file at `.github/PAW/paw.db`. The schema has four core tables.

### decisions — Architectural Choices

Tracks decisions with temporal validity so they can be superseded without deletion.

```sql
CREATE TABLE IF NOT EXISTS decisions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  context     TEXT NOT NULL,            -- what was being decided
  choice      TEXT NOT NULL,            -- what was chosen
  rationale   TEXT NOT NULL,            -- why
  domain      TEXT,                     -- e.g. 'styling', 'testing', 'build'
  valid_from  TEXT NOT NULL DEFAULT (datetime('now')),
  superseded_at TEXT,                   -- NULL = currently active
  superseded_by INTEGER REFERENCES decisions(id),
  source_task TEXT,                     -- task file that produced this decision
  created_by  TEXT DEFAULT 'agent'      -- 'agent' | 'user' | 'imported'
);

CREATE INDEX idx_decisions_active ON decisions(superseded_at) WHERE superseded_at IS NULL;
CREATE INDEX idx_decisions_domain ON decisions(domain);
```

**Example rows**:

| context                    | choice                                               | rationale                                             | domain  |
| -------------------------- | ---------------------------------------------------- | ----------------------------------------------------- | ------- |
| Color token placement      | All colors in centralized theme file via CSS vars    | Prevents specificity wars and enables theme switching | styling |
| Test notification wrapping | Use project notification system, not browser dialogs | Enables clean testing with mock-friendly APIs         | testing |

### patterns — Recurring Codebase Patterns

Tracks observed patterns with occurrence counting. Patterns with high counts become L1 facts.

```sql
CREATE TABLE IF NOT EXISTS patterns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,     -- unique identifier
  description TEXT NOT NULL,            -- one-line explanation
  example     TEXT,                     -- code snippet or file reference
  domain      TEXT,
  occurrences INTEGER NOT NULL DEFAULT 1,
  first_seen  TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_patterns_domain ON patterns(domain);
CREATE INDEX idx_patterns_occurrences ON patterns(occurrences DESC);
```

### agent_memory — Per-Agent Persistent Hints

Each agent can store hints that persist across sessions. The Implementer might note "this project prefers named exports," while the HealthReviewer might record "file-length gate has an allowlist in scripts/."

```sql
CREATE TABLE IF NOT EXISTS agent_memory (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  agent      TEXT NOT NULL,             -- agent name (e.g. 'Implementer')
  hint       TEXT NOT NULL,
  domain     TEXT,
  confidence REAL DEFAULT 1.0,          -- 0.0 to 1.0, decays if contradicted
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_agent_memory_agent ON agent_memory(agent);
```

### task_index — Cross-Reference to Task Files

Indexes task files for rapid lookup by domain, status, or date — without agents needing to `readdir` and parse every markdown file in `.ignore/tasks/`.

```sql
CREATE TABLE IF NOT EXISTS task_index (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path   TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL,            -- NOT_STARTED | IN_PROGRESS | COMPLETED | FAILED
  domain      TEXT,
  summary     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX idx_task_index_status ON task_index(status);
CREATE INDEX idx_task_index_domain ON task_index(domain);
```

---

## Session-End Memory Save Hook

When a session ends, a dedicated hook extracts learnings and persists them to `paw.db`. This runs **before** the session-end health gate (ordered by array position in `hooks.json`).

### What Gets Saved

The hook parses the session context (task file, health report, changed files) to extract:

1. **New decisions** — any architectural choice made during the session
2. **Pattern occurrences** — if a known pattern was applied, increment its count; if a new pattern was observed, create it
3. **Agent hints** — agent-provided notes for future sessions
4. **Task index entry** — register the task file for fast lookup

### Implementation

```typescript
import Database from 'better-sqlite3';
import { readFileSync, existsSync } from 'node:fs';
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

  const db = new Database('.github/PAW/paw.db');
  ensureSchema(db);

  // Find the active task file
  const taskFile = findActiveTaskFile();
  if (taskFile) {
    indexTaskFile(db, taskFile);
  }

  // Extract and store decisions from task file notes section
  if (taskFile) {
    const content = readFileSync(taskFile, 'utf-8');
    const decisions = extractDecisions(content);
    for (const d of decisions) {
      db.prepare(
        `
        INSERT INTO decisions (context, choice, rationale, domain, source_task)
        VALUES (?, ?, ?, ?, ?)
      `,
      ).run(d.context, d.choice, d.rationale, d.domain, taskFile);
    }
  }

  // Increment pattern occurrences for any patterns applied this session
  const appliedPatterns = extractAppliedPatterns(input);
  for (const name of appliedPatterns) {
    const existing = db
      .prepare('SELECT id FROM patterns WHERE name = ?')
      .get(name);
    if (existing) {
      db.prepare(
        `
        UPDATE patterns SET occurrences = occurrences + 1, last_seen = datetime('now')
        WHERE name = ?
      `,
      ).run(name);
    }
  }

  db.close();
  writeHookOutput({ continue: true });
}

/**
 * Ensure all required tables exist (idempotent).
 */
function ensureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      context TEXT NOT NULL,
      choice TEXT NOT NULL,
      rationale TEXT NOT NULL,
      domain TEXT,
      valid_from TEXT NOT NULL DEFAULT (datetime('now')),
      superseded_at TEXT,
      superseded_by INTEGER REFERENCES decisions(id),
      source_task TEXT,
      created_by TEXT DEFAULT 'agent'
    );
    CREATE TABLE IF NOT EXISTS patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      example TEXT,
      domain TEXT,
      occurrences INTEGER NOT NULL DEFAULT 1,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS agent_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent TEXT NOT NULL,
      hint TEXT NOT NULL,
      domain TEXT,
      confidence REAL DEFAULT 1.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS task_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      domain TEXT,
      summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );
  `);
}

function ensureIndices(db: Database.Database): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_decisions_active ON decisions(superseded_at) WHERE superseded_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_decisions_domain ON decisions(domain);
    CREATE INDEX IF NOT EXISTS idx_patterns_domain ON patterns(domain);
    CREATE INDEX IF NOT EXISTS idx_patterns_occurrences ON patterns(occurrences DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_memory_agent ON agent_memory(agent);
    CREATE INDEX IF NOT EXISTS idx_task_index_status ON task_index(status);
    CREATE INDEX IF NOT EXISTS idx_task_index_domain ON task_index(domain);
  `);
}

main().catch(() => writeHookOutput({ continue: true }));
```

### Hook Registration

Add to `hooks.json` — the memory save hook runs **first** in the `sessionEnd` array so the health gate can read the freshest data:

```json
{
  "sessionEnd": [
    {
      "type": "command",
      "bash": "npx tsx --tsconfig tsconfig.scripts.json .github/scripts/hooks/session-end-memory-save.ts",
      "powershell": "npx tsx --tsconfig tsconfig.scripts.json .github/scripts/hooks/session-end-memory-save.ts",
      "cwd": ".",
      "timeoutSec": 15
    },
    {
      "type": "command",
      "bash": "npx tsx --tsconfig tsconfig.scripts.json .github/PAW/pawGates.ts --changed-only",
      "powershell": "npx tsx --tsconfig tsconfig.scripts.json .github/PAW/pawGates.ts --changed-only",
      "cwd": ".",
      "timeoutSec": 120
    }
  ]
}
```

---

## Decision Supersession

Decisions aren't deleted — they're superseded. When a new decision contradicts an old one, the old row gets a `superseded_at` timestamp and a `superseded_by` reference.

```typescript
/**
 * Supersede an existing decision with a new one.
 */
function supersedeDecision(
  db: Database.Database,
  oldId: number,
  newDecision: {
    context: string;
    choice: string;
    rationale: string;
    domain?: string;
    sourceTask?: string;
  },
): void {
  const result = db
    .prepare(
      `
    INSERT INTO decisions (context, choice, rationale, domain, source_task)
    VALUES (?, ?, ?, ?, ?)
  `,
    )
    .run(
      newDecision.context,
      newDecision.choice,
      newDecision.rationale,
      newDecision.domain ?? null,
      newDecision.sourceTask ?? null,
    );

  const newId = result.lastInsertRowid;

  db.prepare(
    `
    UPDATE decisions
    SET superseded_at = datetime('now'), superseded_by = ?
    WHERE id = ?
  `,
  ).run(newId, oldId);
}
```

This creates a full audit trail: you can always see what was decided before and why it changed.

---

## Pre-Generated Query Layer

Agents never touch the database directly. All reads happen through hooks that execute pre-defined SQL and inject results as `additionalContext`. All writes happen through the session-end save hook.

This separation ensures:

1. **Safety** — an agent can't accidentally corrupt the database with bad SQL
2. **Token efficiency** — the hook formats results compactly before injection
3. **Portability** — if the storage backend changes (e.g., to JSON files), only hooks change
4. **Testability** — hooks can be tested independently with a fixture database

### Query Catalog

| Query                             | Used By                               | Returns                             |
| --------------------------------- | ------------------------------------- | ----------------------------------- |
| Active decisions (not superseded) | L1 loader hook                        | Last 5 decisions                    |
| Top patterns by occurrence        | L1 loader hook                        | Patterns with 3+ occurrences        |
| Agent hints                       | L1 loader hook                        | Last 3 hints for the invoking agent |
| Active task                       | L1 loader hook                        | Current IN_PROGRESS task, if any    |
| Decisions by domain               | On-demand (agent requests via prompt) | All active decisions for a domain   |
| Task history by domain            | On-demand                             | Last 5 tasks for a domain           |
| Decision audit trail              | On-demand                             | Full chain of a superseded decision |

---

## Federation — Sharing Knowledge Across Instances

> Federation is an additive layer. PAW works fully standalone without it.

### The Problem

When multiple developers (or the same developer across repos) solve similar problems, knowledge stays siloed. Developer A discovers that "barrel exports cause circular dependency issues in this monorepo" — but Developer B hits the same wall two weeks later.

### Pull-Only Model

PAW federation is read-only by design. An instance can **pull** knowledge from remotes, but never **push** to them. This ensures:

- No write conflicts between instances
- No credentials required (read-only transport)
- Each instance remains the authority for its own data

### Remote Configuration

```sql
CREATE TABLE IF NOT EXISTS remotes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,     -- human-readable name (e.g. 'team-frontend')
  path        TEXT NOT NULL,            -- file path or URL to remote paw.db
  transport   TEXT NOT NULL DEFAULT 'file',  -- 'file' | 'http' (future)
  last_pull   TEXT,                     -- timestamp of last successful pull
  pull_filter TEXT,                     -- SQL WHERE clause fragment for selective pull
  enabled     INTEGER NOT NULL DEFAULT 1
);
```

### Import Tables

Pulled data lands in separate tables — never mixed with local data:

```sql
CREATE TABLE IF NOT EXISTS imported_decisions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  remote_name     TEXT NOT NULL,
  remote_id       INTEGER NOT NULL,       -- original ID in the source database
  context         TEXT NOT NULL,
  choice          TEXT NOT NULL,
  rationale       TEXT NOT NULL,
  domain          TEXT,
  provenance_hash TEXT NOT NULL,           -- SHA-256 of remote_name + remote_id + choice
  imported_at     TEXT NOT NULL DEFAULT (datetime('now')),
  accepted        INTEGER DEFAULT 0,      -- 0 = pending review, 1 = accepted into local
  UNIQUE(remote_name, remote_id)
);

CREATE TABLE IF NOT EXISTS imported_patterns (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  remote_name     TEXT NOT NULL,
  remote_id       INTEGER NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL,
  domain          TEXT,
  occurrences     INTEGER NOT NULL,
  provenance_hash TEXT NOT NULL,
  imported_at     TEXT NOT NULL DEFAULT (datetime('now')),
  accepted        INTEGER DEFAULT 0,
  UNIQUE(remote_name, remote_id)
);
```

### Pull Operation

```typescript
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';

/**
 * Pull decisions and patterns from a remote PAW instance.
 * Only imports rows that don't already exist locally (by provenance hash).
 */
function pullFromRemote(
  localDb: Database.Database,
  remote: { name: string; path: string; pullFilter?: string },
): void {
  const remoteDb = new Database(remote.path, { readonly: true });

  // Pull decisions
  let decisionQuery =
    'SELECT id, context, choice, rationale, domain FROM decisions WHERE superseded_at IS NULL';
  if (remote.pullFilter) {
    decisionQuery += ` AND (${remote.pullFilter})`;
  }

  const remoteDecisions = remoteDb.prepare(decisionQuery).all() as Array<{
    id: number;
    context: string;
    choice: string;
    rationale: string;
    domain: string | null;
  }>;

  const insertDecision = localDb.prepare(`
    INSERT OR IGNORE INTO imported_decisions (remote_name, remote_id, context, choice, rationale, domain, provenance_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const d of remoteDecisions) {
    const hash = createHash('sha256')
      .update(`${remote.name}:${d.id}:${d.choice}`)
      .digest('hex');
    insertDecision.run(
      remote.name,
      d.id,
      d.context,
      d.choice,
      d.rationale,
      d.domain,
      hash,
    );
  }

  // Pull patterns
  let patternQuery =
    'SELECT id, name, description, domain, occurrences FROM patterns';
  if (remote.pullFilter) {
    patternQuery += ` WHERE (${remote.pullFilter})`;
  }

  const remotePatterns = remoteDb.prepare(patternQuery).all() as Array<{
    id: number;
    name: string;
    description: string;
    domain: string | null;
    occurrences: number;
  }>;

  const insertPattern = localDb.prepare(`
    INSERT OR IGNORE INTO imported_patterns (remote_name, remote_id, name, description, domain, occurrences, provenance_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const p of remotePatterns) {
    const hash = createHash('sha256')
      .update(`${remote.name}:${p.id}:${p.name}`)
      .digest('hex');
    insertPattern.run(
      remote.name,
      p.id,
      p.name,
      p.description,
      p.domain,
      p.occurrences,
      hash,
    );
  }

  // Update pull timestamp
  localDb
    .prepare('UPDATE remotes SET last_pull = datetime(?) WHERE name = ?')
    .run(new Date().toISOString(), remote.name);

  remoteDb.close();
}
```

### Accepting Imported Knowledge

Imported data sits in review until explicitly accepted. An agent or user can promote an import to local:

```typescript
/**
 * Accept an imported decision into the local decisions table.
 */
function acceptImportedDecision(db: Database.Database, importId: number): void {
  const imported = db
    .prepare('SELECT * FROM imported_decisions WHERE id = ?')
    .get(importId) as
    | {
        context: string;
        choice: string;
        rationale: string;
        domain: string | null;
      }
    | undefined;

  if (!imported) return;

  db.prepare(
    `
    INSERT INTO decisions (context, choice, rationale, domain, created_by)
    VALUES (?, ?, ?, ?, 'imported')
  `,
  ).run(imported.context, imported.choice, imported.rationale, imported.domain);

  db.prepare('UPDATE imported_decisions SET accepted = 1 WHERE id = ?').run(
    importId,
  );
}
```

### Transport: File-Based (OneDrive, Git, Dropbox)

The simplest federation transport is file-based: the remote's `paw.db` sits in a synced folder (OneDrive, Dropbox, Git LFS) and the local instance reads it directly.

```
# Remote configuration examples

# Same machine, different project
INSERT INTO remotes (name, path, transport)
VALUES ('my-other-project', '/home/user/projects/other/.github/PAW/paw.db', 'file');

# Team member via OneDrive
INSERT INTO remotes (name, path, transport, pull_filter)
VALUES ('alex-frontend', '/mnt/onedrive/shared/alex/.github/PAW/paw.db', 'file', "domain = 'styling'");

# Read-only team knowledge base
INSERT INTO remotes (name, path, transport)
VALUES ('team-patterns', '/mnt/onedrive/team/patterns.paw.db', 'file');
```

---

## Drift Detection Quality Gate

Federation introduces the risk of local decisions drifting from team patterns. A dedicated QualityGate flags when this happens.

```typescript
import Database from 'better-sqlite3';
import type {
  QualityGate,
  GateContext,
  GateResult,
  GateFinding,
} from '../health-check-types';

export const gate: QualityGate = {
  id: 'memory-drift',
  name: 'Memory Drift Detection',
  port: 'custom',
  severity: 'warning',
  appliesTo: ['*'],

  async check(context: GateContext): Promise<GateResult> {
    const findings: GateFinding[] = [];
    const dbPath = `${context.rootDir}/.github/PAW/paw.db`;

    let db: Database.Database;
    try {
      db = new Database(dbPath, { readonly: true });
    } catch {
      return {
        gate: this.id,
        passed: true,
        severity: 'info',
        findings: [],
        stats: { filesChecked: 0, findingsCount: 0, durationMs: 0 },
      };
    }

    // Find imported decisions that contradict local active decisions
    const conflicts = db
      .prepare(
        `
      SELECT
        id.context AS imported_context,
        id.choice AS imported_choice,
        id.remote_name,
        d.choice AS local_choice
      FROM imported_decisions id
      JOIN decisions d ON id.context = d.context
      WHERE id.accepted = 0
        AND d.superseded_at IS NULL
        AND id.choice != d.choice
    `,
      )
      .all() as Array<{
      imported_context: string;
      imported_choice: string;
      remote_name: string;
      local_choice: string;
    }>;

    for (const c of conflicts) {
      findings.push({
        file: '.github/PAW/paw.db',
        rule: 'decision-drift',
        message: `Local decision "${c.local_choice}" for "${c.imported_context}" conflicts with "${c.imported_choice}" from remote "${c.remote_name}"`,
        suggestion:
          'Review and either accept the import or document why the local decision differs',
        severity: 'warning',
      });
    }

    db.close();

    return {
      gate: this.id,
      passed: findings.length === 0,
      severity: findings.length > 0 ? 'warning' : 'info',
      findings,
      stats: { filesChecked: 1, findingsCount: findings.length, durationMs: 0 },
    };
  },
};
```

---

## Database Maintenance

### Bootstrapping

On first run, the session-end save hook calls `ensureSchema()` which creates all tables idempotently. No manual setup needed.

```bash
# Or manually initialize:
npx tsx --tsconfig tsconfig.scripts.json .github/PAW/paw-init.ts
```

### Seeding Initial Knowledge

For new projects, seed the database with known decisions and patterns:

```typescript
import Database from 'better-sqlite3';

const db = new Database('.github/PAW/paw.db');

// Seed a decision
db.prepare(
  `
  INSERT INTO decisions (context, choice, rationale, domain, created_by)
  VALUES (?, ?, ?, ?, 'user')
`,
).run(
  'Color token placement',
  'All color literals in centralized theme file only',
  'Prevents specificity wars and enables theme switching via CSS custom properties',
  'styling',
);

// Seed a pattern
db.prepare(
  `
  INSERT INTO patterns (name, description, domain, occurrences)
  VALUES (?, ?, ?, ?)
`,
).run(
  'barrel-exports',
  'Re-export public API from index.ts at module boundary',
  'code-quality',
  5,
);

db.close();
```

### Garbage Collection

Superseded decisions and stale agent hints accumulate over time. A periodic cleanup keeps the database lean:

```sql
-- Remove decisions superseded more than 90 days ago
DELETE FROM decisions
WHERE superseded_at IS NOT NULL
  AND superseded_at < datetime('now', '-90 days');

-- Remove agent hints with low confidence
DELETE FROM agent_memory
WHERE confidence < 0.3
  AND updated_at < datetime('now', '-30 days');

-- Compact the database (reclaim disk space)
VACUUM;
```

### Gitignore & Backup

```gitignore
# PAW database — personal, not committed
.github/PAW/paw.db
.github/PAW/paw.db-wal
.github/PAW/paw.db-shm
```

Each developer's `paw.db` is personal. The schema definition lives in version-controlled code (`ensureSchema()`) so any developer can bootstrap from scratch. The data is inherently local — team knowledge flows through federation, not through git.

---

## Integration Points

| PAW Component                | How It Integrates with Memory                                     |
| ---------------------------- | ----------------------------------------------------------------- |
| **userPromptSubmitted hook** | Reads paw.db → injects L1 facts into agent context                |
| **postToolUse hook**         | No change — still fast regex lint, no DB access                   |
| **sessionEnd hook (save)**   | Writes decisions, patterns, hints, task index to paw.db           |
| **sessionEnd hook (health)** | Reads task_index for context; drift gate reads imported tables    |
| **QualityGate (drift)**      | Compares local decisions against imported decisions               |
| **Agent L0**                 | Unchanged — .agent.md loaded by VS Code                           |
| **Agent L1**                 | New — hook-injected facts from paw.db                             |
| **Agent L2**                 | Unchanged — on-demand skill/instruction loading                   |
| **Task lifecycle**           | task_index table provides fast lookup without filesystem scanning |
| **Federation**               | pull-only remotes, import tables, provenance hashes               |

---

## Dependency

PAW's memory model requires one additional npm dependency:

```bash
npm install --save-dev better-sqlite3
npm install --save-dev @types/better-sqlite3
```

`better-sqlite3` is synchronous, zero-dependency (native addon), and the fastest SQLite binding for Node.js. It's ideal for hooks where latency matters — a typical L1 query completes in <1ms.

---

## Summary

| Concern              | Solution                                                       |
| -------------------- | -------------------------------------------------------------- |
| Cold-start agents    | L0→L1→L2 tiered loading; L1 injected by hook                   |
| Persistent decisions | `decisions` table with `superseded_at` audit trail             |
| Pattern recognition  | `patterns` table with occurrence counting                      |
| Agent memory         | `agent_memory` table with per-agent hints and confidence decay |
| Task lookup          | `task_index` table replaces filesystem scanning                |
| Team sharing         | Pull-only federation via `remotes` + `imported_*` tables       |
| Drift detection      | QualityGate comparing local vs imported decisions              |
| Safety               | Agents never touch DB; hooks own all I/O                       |

---

## Next Steps

- [Back to README](./README.md)
- [Part 1: Portable Hook System](./01-portable-hook-system.md) — see session-end memory save hook registration
- [Part 2: QualityGate Architecture](./02-quality-gate-architecture.md) — see drift detection gate
- [Part 3: Agent Ecosystem](./03-agent-ecosystem.md) — see tiered loading protocol
