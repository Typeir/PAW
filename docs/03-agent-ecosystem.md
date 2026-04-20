# Part 3: Agent Ecosystem

> Structured agent lifecycle with typed contracts, task-file handoff, and a mandatory health gate.

---

## The A→B→C Lifecycle

Every implementation task flows through three mandatory phases. No phase can be skipped.

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│   A: ANALYSIS   │────▶│ B: IMPLEMENTATION │────▶│ C: COMPLETION AUDIT │
│                 │     │    + HEALTH GATE   │     │                     │
│  Analyzer Agent │     │ Implementer Agent  │     │ CompletionAuditor   │
│                 │     │ HealthReviewer     │     │     Agent           │
└─────────────────┘     └──────────────────┘     └─────────────────────┘
        │                       │                          │
        ▼                       ▼                          ▼
  .ignore/tasks/          Source code +              .ignore/reports/
  {task-file}.md          task file updates          {report-file}.md
```

### Why Three Phases?

1. **Analysis** forces the agent to read architecture docs before writing code. Without this, agents hallucinate patterns, miss constraints, and introduce inconsistencies.
2. **Health Gate** is mandatory and non-bypassable. It catches rule violations before the agent declares "done."
3. **Completion Audit** reconciles every checklist item, preventing partial implementations from being marked complete.

---

## Agent Contract

Each agent role has a typed contract — required inputs, expected outputs, and handoff protocol.

### Phase A: Analyzer

```typescript
/**
 * Contract for the Analyzer agent.
 */
interface AnalyzerContract {
  /** What it receives */
  input: {
    /** User's natural language task description */
    userRequest: string;
    /** Project instructions (copilot-instructions.md) */
    projectContext: string;
  };

  /** What it must produce */
  output: {
    /** Timestamped task file in .ignore/tasks/ */
    taskFile: string;
    /** Task file must have Status: IN_PROGRESS */
    status: 'IN_PROGRESS';
  };

  /** What it must NOT do */
  constraints: [
    'MUST NOT modify source code (src/, scripts/, tests/)',
    'MUST read matching instruction files before generating task summary',
    'MUST read relevant architecture docs',
  ];
}
```

**Responsibilities**:

1. Read the project-wide instructions file
2. Identify which architecture domains the task touches
3. Load matching instruction files (`.instructions.md`) based on affected file globs
4. Scan affected files for scope assessment (line counts, existing patterns)
5. Create a task file following the Task Lifecycle format (see Part 4)
6. Hand off with: "Task summary created. Ready for implementation."

### Phase B: Implementer + HealthReviewer

```typescript
/**
 * Contract for the Implementer agent.
 */
interface ImplementerContract {
  input: {
    /** Must exist and have Status: IN_PROGRESS */
    taskFile: string;
    /** Matching instruction files for affected domains */
    instructionFiles: string[];
  };

  output: {
    /** Modified source files */
    codeChanges: string[];
    /** Updated task file with checked milestones/checklist items */
    taskFileUpdated: true;
    /** Health check + test results recorded in task file */
    healthResults: string;
  };

  constraints: [
    'MUST check for active task file before writing any code',
    'MUST read ALL matching instruction files before starting',
    'MUST stay within declared Scope',
    'MUST keep files under maximum line limit',
    'MUST run health check and tests after implementation',
  ];
}

/**
 * Contract for the HealthReviewer agent.
 */
interface HealthReviewerContract {
  input: {
    taskFile: string;
    instructionFiles: string[];
  };

  output: {
    /** 'PASS' or 'FAIL' with findings list */
    verdict: 'PASS' | 'FAIL';
    /** Classified findings (critical blocks; warnings pass) */
    findings: Array<{ severity: 'critical' | 'warning'; details: string }>;
    /** Task file updated with health results */
    taskFileUpdated: true;
  };

  constraints: [
    'ALWAYS runs — cannot be skipped',
    'MUST execute npm run health:check',
    'MUST execute npm test',
    'MUST classify every finding as critical or warning',
    'MUST block completion if ANY critical finding exists',
  ];
}
```

### Phase C: CompletionAuditor

```typescript
/**
 * Contract for the CompletionAuditor agent.
 */
interface CompletionAuditorContract {
  input: {
    taskFile: string;
  };

  output: {
    /** Completion report in .ignore/reports/ */
    reportFile: string;
    /** Task status set to COMPLETED */
    taskStatus:
      | 'COMPLETED'
      | 'COMPLETED_WITH_WARNINGS'
      | 'COMPLETED_WITH_OVERRIDE';
  };

  constraints: [
    'MUST verify every DoD, Milestone, and Checklist item is checked',
    'MUST verify Health Check Results section is populated',
    'MAY launch subagents for remediation of incomplete items',
    'MUST generate a completion report regardless of outcome',
  ];

  overrideProtocol: {
    /** User can say "override" or "force complete" */
    trigger: string;
    /** Report marks overridden items as tech debt */
    behavior: 'COMPLETED_WITH_OVERRIDE + Overridden Items section';
  };
}
```

---

## Agent Definition Files

Agents are defined in `.github/agents/` as markdown files with YAML frontmatter.

### Format: `.agent.md`

```yaml
---
name: AgentName
description: >
  One-paragraph description of the agent's mission, constraints,
  and where it fits in the A→B→C lifecycle.
tools:
  - read_file
  - grep_search
  - file_search
  - list_dir
  - create_file
  - run_in_terminal
  # ... only the tools this agent needs
---

# Agent Name

## Step 0: Tiered Context Loading (MANDATORY)

Agents wake up in three tiers — each tier adds context only when needed.

### L0 — Identity (Automatic)
This `.agent.md` file is loaded by VS Code Copilot at invocation. The agent knows its name, phase, tool set, and constraints. No action required.

### L1 — Critical Facts (Hook-Injected)
A `userPromptSubmitted` hook queries `paw.db` and injects recent decisions, top patterns, and agent-specific hints as `additionalContext`. This arrives automatically in the first message — the agent should **read and acknowledge** these facts before proceeding.

If L1 facts are present, check for:
- Active task reference (resume vs. new work)
- Relevant decisions that constrain the approach
- Known patterns that apply to the current domain

### L2 — Domain Context (On-Demand)
Read project instructions, matching instruction files, and skill files as needed. This is the existing behavior from the instruction/skill loading tables below.

## Your Mission

{Detailed description of what this agent does}

## Instruction File Loading

{Table mapping affected file paths → instruction files to read}

## Constraints

{Numbered list of hard constraints}

## Handoff

{What to say when handing off to the next agent}
```

### Tool Restrictions

Each agent should only have the tools it needs. This prevents accidental scope creep:

| Agent             | Read | Write                    | Terminal                | Subagent |
| ----------------- | ---- | ------------------------ | ----------------------- | -------- |
| Analyzer          | ✅   | `create_file` only       | ✅ (read-only commands) | ❌       |
| Implementer       | ✅   | ✅                       | ✅                      | ✅       |
| HealthReviewer    | ✅   | `replace_string_in_file` | ✅                      | ❌       |
| CompletionAuditor | ✅   | ✅                       | ✅                      | ✅       |

---

## The Task File — Inter-Agent Communication Medium

The task file is the single artifact that flows between all agents. It's a markdown file with machine-parseable sections.

### Filename Convention

```
YYYY-MM-DD-HHMMSS-{kebab-task-title}.md
```

Example: `2026-04-09-143022-add-search-debounce.md`

### Required Sections

```markdown
# Task: {Title}

**Created**: {ISO timestamp}
**Status**: {NOT_STARTED | IN_PROGRESS | BLOCKED | COMPLETED | FAILED}
**Owner**: {agent name or "user"}
**Related Files**: {comma-separated list of affected files}

---

## Description

{1-3 paragraphs describing what and why}

## Scope

- **In Scope**: {bullet list}
- **Out of Scope**: {bullet list}

## Architecture Analysis

{Which domains and docs were consulted}

## Definition of Done (DoD)

- [ ] All code changes compile without errors
- [ ] Exported declarations have JSDoc
- [ ] No inline comments in function bodies
- [ ] Tests exist for modified source files
- [ ] Health check passes
- [ ] {task-specific items}

## Acceptance Criteria

1. Given X, when Y, then Z
2. Given A, when B, then C

## Milestones

- [ ] M1: {checkpoint description}
- [ ] M2: {checkpoint description}

## Checklist

- [ ] {Step 1}
- [ ] {Step 2}
- [ ] {Step 3}

## Health Check Results

{Populated by HealthReviewer — leave empty at creation}

## Notes

{Blockers, decisions, remediation log}
```

### Machine-Readable Markers

Agents parse these markers for automated verification:

| Marker                    | Parsed For                                 |
| ------------------------- | ------------------------------------------ |
| `**Status**:` line        | Lifecycle state                            |
| `- [ ]`                   | Unchecked item (incomplete)                |
| `- [x]`                   | Checked item (complete)                    |
| `## Health Check Results` | Section boundary for health data injection |
| `**Related Files**:`      | File impact analysis                       |

### Completion Validation Logic

```typescript
interface ReconcileResult {
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

A task is complete when:

1. Status is not `BLOCKED` or `FAILED`
2. ALL `- [ ]` items in DoD, Milestones, and Checklist are `- [x]`
3. Health Check Results section has content (>10 characters)

---

## Completion Reports

After the CompletionAuditor verifies everything, it generates a report in `.ignore/reports/`:

```
YYYY-MM-DD-HHMMSS-report-{kebab-task-title}.md
```

### Report Structure

```markdown
# Completion Report: {Title}

**Generated**: {ISO timestamp}
**Task File**: .ignore/tasks/{filename}
**Final Status**: COMPLETED

---

## Summary

{2-3 sentences of what was accomplished}

## Changes Made

| File   | Action           | Lines Changed |
| ------ | ---------------- | ------------- |
| {path} | created/modified | +N/-M         |

## Health Check Results

| Gate         | Result  | Findings |
| ------------ | ------- | -------- |
| file-length  | ✅ PASS | 0        |
| antipatterns | ✅ PASS | 0        |

## Definition of Done Verification

{All DoD items with final status}

## Remediation Log

{If remediation loops occurred, document iterations}

## Manifest

- **Task file**: .ignore/tasks/{task-file}
- **Report file**: .ignore/reports/{report-file}
- **Health gate**: PASS
- **Tests**: PASS
```

---

## Agent Memory

Each agent can read and write persistent hints via the memory store. This allows agents to learn from prior sessions.

### What Agents Remember

| Agent             | Remembers                                     | Example                                                 |
| ----------------- | --------------------------------------------- | ------------------------------------------------------- |
| Analyzer          | Domain patterns, common scope decisions       | "style changes usually require theme token review"      |
| Implementer       | Code patterns, module conventions             | "this project uses barrel exports at module boundaries" |
| HealthReviewer    | Gate allowlists, known exceptions             | "component-x.tsx is in the file-length allowlist"       |
| CompletionAuditor | Common incomplete items, remediation patterns | "test files are often forgotten for utility modules"    |

### How Memory Flows

```
Session N                    paw.db                    Session N+1
─────────                    ──────                    ───────────
Agent works              │                         │
  ↓                      │                         │
Session-end save hook ──▶│ INSERT hints,           │
                         │ decisions, patterns      │
                         │                         │
                         │    L1 loader hook ──────▶ Agent gets context
                         │    (userPromptSubmitted)  at session start
```

Agents never touch the database directly — all I/O flows through hooks. See [Part 7](./07-agent-memory-model.md) for the complete schema and query catalog.

---

## Extending the Agent Ecosystem

### Adding a New Agent Role

1. Create `.github/agents/{name}.agent.md` with YAML frontmatter
2. Define the agent's contract (inputs, outputs, constraints)
3. Add the agent to the `AGENTS.md` registry
4. If the agent participates in the lifecycle, define its phase position

### Domain-Specific Agents

Beyond the core lifecycle agents, you can create domain-specific agents:

| Agent               | Phase           | Purpose                                                   |
| ------------------- | --------------- | --------------------------------------------------------- |
| ContentDrafter      | B (specialized) | Writes content files following domain templates           |
| ContentRefactor     | B (specialized) | Restructures existing content without adding new material |
| SecurityReviewer    | Between B and C | Runs OWASP checks, dependency audits                      |
| PerformanceReviewer | Between B and C | Lighthouse, bundle size, render counts                    |

Domain agents follow the same contract pattern but slot into the lifecycle at specific points.

---

## Related

- [Part 7: Agent Memory Model](./07-agent-memory-model.md) — SQLite schema, tiered loading, federation

---

## Next: [Part 4 — Skills & Instructions](./04-skills-and-instructions.md)
