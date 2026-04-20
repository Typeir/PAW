# Part 4: Skills & Instructions

> Composable knowledge modules for agents — domain skills, contextual instructions, and slash-command prompts.

---

## Three Knowledge Layers

Agents receive contextual knowledge from three complementary systems:

```
┌─────────────────────────────────────────────────────────┐
│                    PROMPTS (/.github/prompts/)           │
│  User-invokable slash commands that trigger workflows   │
│  e.g. /start-task, /run-health, /add-component          │
└───────────────────────┬─────────────────────────────────┘
                        │ triggers
┌───────────────────────▼─────────────────────────────────┐
│                    SKILLS (/.github/skills/)             │
│  Domain knowledge modules loaded by agents on demand    │
│  e.g. task-lifecycle, content-format, lore-context       │
└───────────────────────┬─────────────────────────────────┘
                        │ provides rules for
┌───────────────────────▼─────────────────────────────────┐
│              INSTRUCTIONS (/.github/instructions/)       │
│  File-scoped rules applied automatically by glob match   │
│  e.g. jsdoc-standards → src/**/*.ts                      │
└─────────────────────────────────────────────────────────┘
```

**Key distinction**:

- **Instructions** are automatic — they activate based on which files are being edited
- **Skills** are explicit — agents load them when a domain is relevant
- **Prompts** are user-initiated — slash commands that kick off workflows

---

## Instructions — Automatic Contextual Rules

### Structure

Each instruction file lives in `.github/instructions/` and has `applyTo` glob patterns in its YAML frontmatter:

```yaml
---
title: JSDoc Standards
applyTo: 'src/**/*.ts,src/**/*.tsx,scripts/**/*.ts'
---

# JSDoc Standards

## Hard Rules

1. Every exported declaration MUST have a JSDoc comment
2. No inline comments (`//`) in function bodies (exemptions: eslint, @ts-, TODO:)
3. ...
```

### How applyTo Works

When an agent is about to edit a file, it matches the file path against all instruction files:

```
Editing: src/lib/components/search/SearchBar.tsx

Matches:
  ✅ jsdoc-standards.instructions.md    (src/**/*.tsx)
  ✅ style-rules.instructions.md         (src/**/*.tsx)
  ❌ testing.instructions.md             (tests/**/*.test.*)
  ❌ content-format.instructions.md      (content/**/*.mdx)
```

Multiple instruction files can match simultaneously. The agent must read ALL matching files before making changes.

### Instruction File Convention

| Section       | Purpose                                                 |
| ------------- | ------------------------------------------------------- |
| Hard Rules    | Non-negotiable constraints (build failures if violated) |
| Patterns      | Recommended patterns with code examples                 |
| Anti-Patterns | Common mistakes to avoid                                |
| Verification  | How to check compliance (grep commands, test commands)  |

### Creating a New Instruction File

```yaml
---
title: API Route Standards
applyTo: 'src/app/api/**/*.ts'
---

# API Route Standards

## Hard Rules

1. All route handlers must validate input with Zod schemas
2. Error responses must use the standard error envelope
3. ...

## Patterns

### Request Validation

\`\`\`typescript
import { z } from 'zod';

const schema = z.object({
  id: z.string().uuid(),
  locale: z.enum(['en', 'es', 'fi']),
});

export async function GET(request: Request) {
  const params = schema.parse(Object.fromEntries(new URL(request.url).searchParams));
  // ...
}
\`\`\`

## Verification

\`\`\`bash
# Check for unvalidated route handlers
grep -rn "export async function" src/app/api/ --include="*.ts" | grep -v "schema.parse"
\`\`\`
```

---

## Skills — Domain Knowledge Modules

### Structure

Each skill lives in `.github/skills/{name}/SKILL.md`:

```yaml
---
name: task-lifecycle
description: >
  Manages agile task lifecycle. Creates timestamped task summaries,
  validates completion, handles remediation loops.
requires: []  # Optional dependency list
---

# Task Lifecycle Skill

## Purpose
{When and why to use this skill}

## When to Use
- At implementation start: generate task summary
- At completion: verify all checklist items
- During remediation: update task file

## Detailed Guidance
{Domain-specific rules, templates, code patterns}
```

### Skill Composition Protocol

Skills can declare dependencies via `requires`:

```yaml
---
name: content-page-types
description: Templates for each content type
requires:
  - content-lore # Must load lore context first
---
```

When an agent loads `content-page-types`, the skill loader should resolve the dependency graph:

```
content-page-types
  └── requires: content-lore
        └── requires: [] (no further deps)

Load order: content-lore → content-page-types
```

### Skill Resolution Algorithm

```typescript
/**
 * Resolve skill dependencies and return load order.
 * Throws on circular dependencies.
 */
function resolveSkills(
  requested: string[],
  allSkills: Map<string, { requires: string[] }>,
): string[] {
  const resolved: string[] = [];
  const seen = new Set<string>();
  const visiting = new Set<string>();

  function visit(name: string): void {
    if (seen.has(name)) return;
    if (visiting.has(name))
      throw new Error(`Circular skill dependency: ${name}`);
    visiting.add(name);

    const skill = allSkills.get(name);
    if (!skill) throw new Error(`Unknown skill: ${name}`);

    for (const dep of skill.requires) {
      visit(dep);
    }

    visiting.delete(name);
    seen.add(name);
    resolved.push(name);
  }

  for (const name of requested) visit(name);
  return resolved;
}
```

### When to Create a Skill vs. an Instruction

| Use Case                                   | Mechanism   | Why                                |
| ------------------------------------------ | ----------- | ---------------------------------- |
| Rules that apply to all `.ts` files        | Instruction | Automatic activation by file glob  |
| Domain knowledge needed for specific tasks | Skill       | Explicit loading when relevant     |
| Cross-cutting concern (testing patterns)   | Instruction | Applies regardless of domain       |
| Content-type templates (page structures)   | Skill       | Only needed when writing content   |
| Project conventions (naming, architecture) | Instruction | Always relevant for affected files |

---

## Prompts — User-Invokable Workflows

### Structure

Prompts live in `.github/prompts/` as markdown files with YAML frontmatter:

```yaml
---
description: 'Start a new implementation task — analyzes architecture, creates task summary'
agent: 'agent'
---

# Start Task

You are beginning a new implementation task. Follow this workflow exactly:

## Step 1: Identify Architecture Domains
{Instructions for the agent}

## Step 2: Read Architecture Docs
{Table mapping domains → docs to read}

## Step 3: Scan Affected Files
{How to assess scope}

## Step 4: Generate Task Summary
{Use task-lifecycle skill format}
```

### Prompt Frontmatter Fields

| Field         | Values                  | Purpose                                 |
| ------------- | ----------------------- | --------------------------------------- |
| `description` | String                  | One-liner shown in slash command picker |
| `agent`       | `'agent'` or agent name | Routes to specific agent or default     |

### Reference Prompt Set

A minimal workflow system needs these prompts:

| Prompt File                      | Slash Command    | Agent             | Purpose                                |
| -------------------------------- | ---------------- | ----------------- | -------------------------------------- |
| `start-task.prompt.md`           | `/start-task`    | Analyzer          | Analyze task, create task summary      |
| `full-workflow.prompt.md`        | `/full-workflow` | Default           | Run all three phases (A→B→C)           |
| `run-health.prompt.md`           | `/run-health`    | HealthReviewer    | Execute health gate, classify findings |
| `reconcile-completion.prompt.md` | `/reconcile`     | CompletionAuditor | Verify all items, generate report      |
| `fix-health.prompt.md`           | `/fix-health`    | Implementer       | Remediate specific health failures     |
| `add-component.prompt.md`        | `/add-component` | Implementer       | Scaffold component + test + styles     |
| `add-test.prompt.md`             | `/add-test`      | Implementer       | Create test file following patterns    |

### Creating a New Prompt

1. Create `.github/prompts/{name}.prompt.md`
2. Add YAML frontmatter with `description` and `agent`
3. Write step-by-step instructions for the agent
4. Reference relevant skills and instruction files

---

## Connecting the Three Layers

Here's how they work together in a typical task:

```
User: /start-task "Add debounce to search input"
  │
  ├── PROMPT: start-task.prompt.md activates
  │     └── Routes to Analyzer agent
  │
  ├── AGENT: Analyzer reads copilot-instructions.md
  │     └── Identifies domains: src/**/*.tsx, tests/
  │
  ├── INSTRUCTIONS: Auto-matched by file globs
  │     ├── jsdoc-standards.instructions.md (src/**/*.tsx)
  │     ├── style-rules.instructions.md (src/**/*.tsx)
  │     └── testing.instructions.md (tests/**/*.test.*)
  │
  ├── SKILLS: Loaded explicitly by Analyzer
  │     └── task-lifecycle/SKILL.md (for task file format)
  │
  └── OUTPUT: .ignore/tasks/2026-04-09-143022-add-search-debounce.md
```

---

## Directory Layout

```
.github/
  instructions/
    jsdoc-standards.instructions.md     ← applyTo: src/**/*.ts
    style-rules.instructions.md         ← applyTo: src/**/*.scss
    testing.instructions.md             ← applyTo: tests/**/*.test.*
    api-routes.instructions.md          ← applyTo: src/app/api/**
    {domain}.instructions.md            ← applyTo: {glob}
  skills/
    task-lifecycle/
      SKILL.md
    content-format/
      SKILL.md
    {domain}/
      SKILL.md
  prompts/
    start-task.prompt.md
    full-workflow.prompt.md
    run-health.prompt.md
    reconcile-completion.prompt.md
    fix-health.prompt.md
    add-component.prompt.md
    add-test.prompt.md
    {workflow}.prompt.md
```

---

## Next: [Part 5 — CI/CD Integration](./05-ci-cd-integration.md)
