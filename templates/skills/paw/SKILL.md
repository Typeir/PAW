---
name: paw
description: >
  PAW (Portable Agentic Workflow) quality-enforcement framework. Enforcement
  loop, violation lifecycle, .pawignore, gates, hooks, plugins, deadlock avoidance.
  Load before PAW config, violation debugging, or framework extension.
---

# PAW Framework

## What

Quality-enforcement layer between agent + codebase. Runs gates (checks) on
every edit. Blocks until violations fixed. Real-time linter at agent level.

## Layout

```
.github/PAW/          ← Core (runtime, adapters, types, sync)
  hooks/              ← Defaults (→ .paw/ on sync)
  templates/          ← Synced (skills, agents, prompts, tsconfig)
  adapters/           ← Surface adapters
  cli/                ← Commands (status, violations, gates, unblock)
  docs/               ← Documentation

.paw/                 ← Project install (gitignored)
  hooks/              ← Active (from .github/PAW/hooks/)
  gates/              ← Quality gates (*.gate.ts)
  plugins/            ← Hooks (gate-name/*.ts)
  config.json         ← Surface config
  paw.sqlite          ← Violations DB
  paw.log             ← Hook log

.pawignore            ← Skip patterns
.github/hooks/hooks.json ← Generated (VS Code reads)  
```

## Enforcement Loop

1. Agent edits file
2. PostToolUse fires → runs gates
3. Critical violations found? → write to DB, warn agent
4. Next tool call → PreToolUse fires → checks DB
5. Violations on THIS file? → ALLOWED (fix it). Other file? → DENIED.
6. File fixed → PostToolUse re-runs → resolved. All unblocked.

## Deadlock Rules

**1. Fix immediately.** Violations block all tools until file clean.

**2. Session-scoped.** Session A violations ≠ block Session B. Project-scope violations block everyone.

**3. Exempt tools never blocked:** read_file, grep_search, file_search, semantic_search, list_dir, get_errors, get_terminal_output, memory, manage_todo_list.

**4. .pawignore always allowed.** Patterns in .pawignore + .github/PAW/, .paw/ editable anytime.

**5. Indirect-fix unblocks all.** If violation marked `indirectFix: true` (fix needs new file, not current), gates allow tools through to create fix file.

**6. Last resort: unblock.** User runs `npm run paw:unblock` (password). Clears all violations.

## .pawignore

Glob patterns at root. Matched files:
- Skipped by PostToolUse (no gates)
- Always editable during PreToolUse
- Excluded from health checks

Built-in (no .pawignore needed): `.github/PAW/`, `.paw/`

## Gates

.paw/gates/*.gate.ts auto-discovered. Export: `QualityGate` interface.
- `id`, `name`, `severity` (critical|warning), `appliesTo` (globs), `check(context)` method
- Critical = blocks. Warning = report only.
- Findings with `indirectFix: true` don't block when sole violations remain.

## Hooks

.paw/hooks/ map to lifecycle:
- `preToolUse.mjs` → before tool (enforcement)
- `postToolUse.mjs` → after tool (detect)
- `sessionEnd*.mjs` → session close

`paw sync` copies defaults, regenerates .github/hooks/hooks.json (VS Code reads).

## Plugins

.paw/plugins/{hook-name}/*.ts. Survive `paw sync --force`. Receive hook input, return messages.

## Commands

| Cmd | Purpose |
| --- | --- |
| paw:install | Setup (deps, compile, sync, init DB) |
| paw:status | Status + violations |
| paw:violations | List violations |
| paw:gates | List gates |
| paw:gates run | Run all |
| paw:unblock | Clear all (password) |

## Extend PAW

**New gate (TS):** .paw/gates/{name}.gate.ts → export QualityGate
**New gate (other):** .paw/gates/{name}.{ext}, add runner to config.json  
**New hook:** .paw/hooks/{name}.ts, run `paw sync`
**New plugin:** .paw/plugins/{hook-name}/{name}.ts
**Ignore path:** add to .pawignore  
**Suppress inline:** `/* paw:gate:{id}:{rule} ignore */`

## Gate Ignore Directives

Suppress violations with comments:

```
/* paw:gate:{id} ignore */              all rules, whole file
/* paw:gate:{id}:{rule} ignore */       one rule, whole file
/* paw:gate:{id} ignore-nextline */     next line only
/* paw:gate:{id}:{rule} ignore-nextline */ one rule, next line
/* paw:gate:* ignore */                 ALL gates, whole file
```

Valid in TS/MDX/HTML comments.

```ts
/* paw:gate:* ignore */
// Use on generated files only — suppresses every gate
```
```

```ts
/* paw:gate:antipatterns:console-log ignore */
// Suppress only the console-log rule from the antipatterns gate
```

```mdx
{/* paw:gate:content-format:missing-h1 ignore */}
```

### Rules

- **Never use `paw:gate:* ignore`** in hand-authored files. Reserve it for generated output.
- **Prefer the narrowest scope**: `gate:rule` over `gate:*`, `ignore-nextline` over `ignore`.
- **Never suppress `missing-test`** — create the test file instead.
- `health:check-ignore` is **deprecated**. Do not use it in new files.
