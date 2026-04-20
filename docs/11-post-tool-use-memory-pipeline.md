# Part 11: PostToolUse Memory Pipeline

> The two-layer system that powers agent memory persistence: sync violation detection feeds L1 context, while async memory drafting learns file-specific patterns for future sessions.

---

## Overview

The `post-tool-use.ts` hook has two independent responsibilities that operate in parallel:

```
File edited by agent
    ↓
[PostToolUse Hook Fires]
├────────────────────────────────────────────────┐
│                                                │
│  LAYER 1: VIOLATIONS (SYNCHRONOUS)            │
│  ├─ Run quality gates on edited file          │
│  ├─ Collect findings                          │
│  ├─ Write violations to paw.db                │
│  ├─ Build warning for agent                   │
│  └─ BLOCK agent if critical violations        │
│                                                │
└────────────────────────────────────────────────┘
              AND (parallel)
┌────────────────────────────────────────────────┐
│                                                │
│  LAYER 2: MEMORY DRAFTING (ASYNCHRONOUS)      │
│  ├─ Queue async job (no blocking)             │
│  ├─ spaCy analyze file structure              │
│  ├─ Mini-LLM generate rich context summary    │
│  ├─ Extract patterns (imports, exports, etc.) │
│  ├─ Infer file-specific rules                 │
│  ├─ Store in paw.db.file_memories             │
│  └─ Return to background (agent unfrozen)     │
│                                                │
└────────────────────────────────────────────────┘
        ↓               ↓
   VIOLATIONS      FILE_MEMORY
   (immediate       (available
    L1 injection)   next session)
```

---

## Layer 1: Violations (Synchronous)

**Timing**: Runs to completion before PostToolUse returns.

**Purpose**: Enforce quality gates and block agent if critical issues exist.

**Flow**:

1. Query `.paw/gates/*.gate.ts` for rules matching the edited file
2. Run each gate's `check()` method synchronously
3. Collect critical findings
4. Write findings to `paw.db` (violations table) with session ID
5. Format findings as warning message
6. PreToolUse reads this warning on next tool call (blocking until resolved)

**Integration**:

```typescript
// post-tool-use.ts (sync part)
export async function postToolUse(context: PostToolUseContext): Promise<void> {
  const violations = await runGatesSynchronously(context.editedFiles);
  
  if (violations.critical.length > 0) {
    writeViolationsToDb(violations);
    return buildWarningMessage(violations);
  }
}
```

This is your existing enforcement system—no change needed.

---

## Layer 2: Memory Drafting (Asynchronous)

**Timing**: Spawned as background job; PostToolUse returns immediately to unblock the agent.

**Purpose**: Extract and cache file-specific patterns so future agent sessions have pre-loaded context via L1.

**Flow**:

1. For each edited file, queue an async job
2. Job spawns (doesn't block PostToolUse return)
3. In background:
   - Load file content
   - Run spaCy analysis (imports, exports, structure, naming patterns)
   - Call mini-LLM (`gpt-4-mini` or `gpt-5-mini`) to generate 3–5 sentence summary
   - Extract inferred rules ("uses barrel exports", "JSDoc required", etc.)
   - Store in `paw.db.file_memories` with file_path, pattern_hash, content_hash
4. Return to background queue when complete

**Integration**:

```typescript
// post-tool-use.ts (async part)
export async function postToolUse(context: PostToolUseContext): Promise<void> {
  const violations = await runGatesSynchronously(context.editedFiles);
  
  if (violations.critical.length > 0) {
    writeViolationsToDb(violations);
  }
  
  // Queue memory work without awaiting
  for (const file of context.editedFiles) {
    queueMemoryDraftingJob(file).catch(console.error);
  }
  
  // Return to agent immediately
}
```

**Memory Drafting Job** (runs in background):

```typescript
async function draftFileMemory(filePath: string): Promise<void> {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const contentHash = hash(content);
    
    // Local analysis (fast)
    const spacyPatterns = await spacy.analyze(content, filePath);
    
    // Mini-model inference (cheap, fast)
    const summary = await openai.chat.completions.create({
      model: 'gpt-4-mini', // or gpt-5-mini
      messages: [{
        role: 'user',
        content: `File: ${filePath}\n\nSpaCy patterns:\n${JSON.stringify(spacyPatterns)}\n\nGenerate a 3-5 sentence memory about this file's structure, conventions, and inferred rules.`,
      }],
      max_tokens: 150,
    });
    
    const memory = summary.choices[0].message.content;
    
    // Store with content hash (for staleness detection)
    db.prepare(`
      INSERT OR REPLACE INTO file_memories
      (file_path, pattern_hash, memory, content_hash, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(filePath, hash(spacyPatterns), memory, contentHash);
    
  } catch (error) {
    console.error(`Memory draft failed for ${filePath}:`, error);
  }
}
```

**Why Async?**
- Agent isn't frozen waiting for LLM inference
- Memory is available for the *next* agent session (not this one)
- Multiple files can be analyzed in parallel
- Failures don't cascade (if one file's memory job fails, others continue)

---

## L1 Integration: Pre-Tool Hook

When the agent prepares its next tool call, `pre-tool.ts` injects both violation warnings *and* file-specific memories into L1:

```typescript
// pre-tool.ts (L1 injection)
async function injectL1Context(): Promise<string> {
  const db = new Database('.paw/paw.db', { readonly: true });
  const context: string[] = [];
  
  // Violations (from sync layer)
  const violations = db.prepare(`
    SELECT file_path, message
    FROM violations
    WHERE session_id = ? AND resolved_at IS NULL
  `).all(currentSessionId);
  
  for (const v of violations) {
    context.push(`⚠️ ${v.file_path}: ${v.message}`);
  }
  
  // File-specific memories (from async layer)
  const targetFile = context.currentFile;
  const memory = db.prepare(`
    SELECT memory
    FROM file_memories
    WHERE file_path = ? AND content_hash = ?
  `).get(targetFile, currentContentHash);
  
  if (memory) {
    context.push(`📝 File context: ${memory.memory}`);
  }
  
  return context.join('\n');
}
```

**Result**: Agents get violations (blocking if critical) + learned patterns (for context) in a single L1 injection.

---

## Nightly Optimization Job

Once per day (or on-demand via CLI), run housekeeping:

```typescript
async function nightly(): Promise<void> {
  const db = new Database('.paw/paw.db');
  
  // 1. Remove stale memories (older than 30 days)
  db.prepare(`
    DELETE FROM file_memories
    WHERE created_at < datetime('now', '-30 days')
  `).run();
  
  // 2. Deduplicate identical memories
  db.prepare(`
    DELETE FROM file_memories
    WHERE id NOT IN (
      SELECT MIN(id)
      FROM file_memories
      GROUP BY file_path, memory
    )
  `).run();
  
  // 3. Compute repo-wide patterns (aggregate L3)
  const patterns = db.prepare(`
    SELECT memory, COUNT(*) as freq
    FROM file_memories
    WHERE memory LIKE '%barrel%'
    GROUP BY memory
    ORDER BY freq DESC
  `).all();
  
  // Store as repo conventions
  db.prepare(`
    INSERT OR REPLACE INTO repo_conventions
    (name, description, frequency)
    VALUES (?, ?, ?)
  `).run('barrel-export-pattern', patterns[0]?.memory, patterns[0]?.freq);
  
  db.close();
}
```

---

## Schema

### file_memories Table

```sql
CREATE TABLE IF NOT EXISTS file_memories (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path      TEXT NOT NULL,
  pattern_hash   TEXT,
  memory         TEXT NOT NULL,
  content_hash   TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now')),
  
  UNIQUE (file_path, content_hash)
);
```

### repo_conventions Table

```sql
CREATE TABLE IF NOT EXISTS repo_conventions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT UNIQUE NOT NULL,
  description    TEXT,
  frequency      INTEGER DEFAULT 1,
  updated_at     TEXT DEFAULT (datetime('now'))
);
```

---

## Why This Design

| Aspect | Benefit |
|--------|---------|
| **Sync violations** | Agent gets immediate feedback; critical issues block further work |
| **Async memory** | No performance penalty; patterns learned without freezing agent |
| **Content hash** | Memory invalidates when file changes; stale patterns don't linger |
| **Nightly cleanup** | DB doesn't bloat; old memories culled, repo conventions aggregated |
| **Mini-LLM summaries** | Free tier models make pattern capture economical; richer than regex alone |
| **File-scoped L1** | Agent receives pre-loaded context specific to the file it's editing |

---

## Configuration

```json
// .paw/paw.config.json
{
  "postToolUse": {
    "violations": {
      "enabled": true,
      "syncBlock": true
    },
    "memoryDrafting": {
      "enabled": true,
      "async": true,
      "model": "gpt-4-mini",
      "maxTokens": 150
    },
    "nightly": {
      "enabled": true,
      "schedule": "02:00 UTC",
      "retention": 30
    }
  }
}
```

---

## Future Extensions

- **L3 analysis layer** — Graph analysis of decision relationships (Neo4j, run weekly)
- **Pattern confidence scoring** — Rank inferred rules by evidence strength
- **Multi-file patterns** — "Files in this folder share this pattern" aggregates
- **Agent-specific memory** — Different agents get different L1 context based on their role
- **Federated memory sync** — Share learned patterns across team instances (pull-only)

---

**Author:** David  
**Status:** Implementation in progress  
**Related**: Part 7 (Agent Memory Model), Part 10 (Copilot SDK Integration)
