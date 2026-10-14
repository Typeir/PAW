---
name: paw-tasks
description: Read this repository's work graph — tasks, their parents and children, and rolled-up points — with the `paw tasks` command. Use when the work names a task id, asks what a task belongs to or depends on, or needs the backlog. Read-only.
---

# paw tasks

This repository's work items live in PAW's work model. Read them only through
`paw tasks`, run from the repository root. Do not open `.paw/tasks.json` or
anything under `.paw/modules/`.

| Need | Command |
| --- | --- |
| Every task | `paw tasks` |
| One task | `paw tasks <id>` |
| One task, its ancestors, and its descendants | `paw tasks <id> --related` |

## Reading the output

`paw tasks` prints one row per task, parents before children, indented by depth:

```
tasks: 3 in the graph
  a  Epic  ↑ —  ↓ b  6
    b  Story  ↑ a  ↓ c  5
      c  Task  ↑ b  ↓ —  3
```

- `↑` parents, `↓` children; `—` means none. A task can have several parents.
- The last number is the task's points plus every descendant's, each counted once.
- `(orphan)` after an id: the task names a parent the graph does not hold.
- `loops: N declared, not walked`: edges that would close a cycle. They are recorded and never followed.
- `dangling: N naming an absent task`: edges whose other end does not exist.
- `refused: N`: entries the task document could not load, each with the reason.

`paw tasks <id>` prints the task's depth, rollup, parents, children, loops, and
dangling edges. `--related` adds every ancestor and descendant with its title.

## When it refuses

Exit code 1 means there is no graph to read, and the message names the fix:

- The `paw-agile` module is not enabled, or not installed: tell the user. Do not enable or install it yourself.
- `no task "<id>"`: run `paw tasks` to list the ids that exist.

There is no write command. Do not edit task data.
