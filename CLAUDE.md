# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The repository's agent guidance is host-agnostic and lives in one file. Read it:

@AGENTS.md

## Claude Code specifics

- **Use the PowerShell tool for npm, node, and vitest.** The Bash tool is Git Bash; `node` resolves
  there but the fnm shim errors on it. Use Bash for file reading, searching, and POSIX scripting.
- Long test sweeps across every package exceed the 120s default timeout — raise `timeout` or run
  them in the background rather than assuming a hang.
- When you touch `packages/gui`, run `npm run build:console` before claiming a console change works.
  The daemon serves a built bundle, not the source tree.
- Prove console changes by capture rather than by description:
  `electron dist/main.cjs --root=<repo> --capture` writes `dist/capture.png`, which Read renders.
  It opens on the console's default section, so seeing another view means temporarily changing the
  initial section in `packages/gui/src/domain/consoleState.ts` — revert it before finishing.
