/**
 * PAW Init Scaffold
 *
 * @fileoverview What attaching PAW to a repository writes into it: a
 * host-agnostic `.paw/config.json` descriptor and a git hook that shells out to
 * the globally-installed `paw` on PATH. No framework code is copied — the repo
 * declares where its gates, connectors, plans, and bindings live, and defers to
 * the installed binary (decision doc 21).
 *
 * This is policy about what attaching *means*, so it lives in the domain rather
 * than in the installer: more than one surface can attach a repository, and the
 * bytes written must not depend on which one did it. Pure — it returns a plan of
 * file writes and performs none, so the exact bytes are a unit test.
 *
 * @module @paw/core/domain/initScaffold
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { resolveInit, type InitMode, type InitOutcome } from './initConfig.js';
import { joinPath } from './paths.js';

/**
 * A single file an attach will write.
 *
 * @interface FileWrite
 * @property {string} path - Absolute path to write.
 * @property {string} content - The file contents.
 * @property {boolean} executable - Whether the file needs the executable bit (git hooks).
 */
export interface FileWrite {
  readonly path: string;
  readonly content: string;
  readonly executable: boolean;
}

/**
 * The plan an attach produces for a repo root.
 *
 * @interface InitPlan
 * @property {string} root - The repo root being attached.
 * @property {FileWrite[]} writes - The files to write.
 * @property {Extract<InitOutcome, { kind: 'refuse' }>} [refusal] - Present when an existing config stopped the config write; the rest of the plan still stands.
 */
export interface InitPlan {
  readonly root: string;
  readonly writes: readonly FileWrite[];
  readonly refusal?: Extract<InitOutcome, { kind: 'refuse' }>;
}

/**
 * The host-agnostic descriptor written to `.paw/config.json`. A repo declares
 * where its own PAW artefacts live; the installed binary reads this — nothing is
 * vendored.
 */
const DEFAULT_CONFIG = {
  root: '.paw',
  gatesDir: '.paw/gates',
  connector: 'copilot-hooks',
  models: {},
  roles: {},
} as const;

/**
 * A git hook body that defers to the globally-installed `paw` on PATH. Fails the
 * commit only when `paw` fails; a missing `paw` is surfaced, not swallowed.
 *
 * @param {string} command - The `paw` subcommand to run.
 * @returns {string} The hook script.
 */
function hook(command: string): string {
  return `#!/bin/sh\n# Installed by \`paw init\`. Delegates to the global paw on PATH.\nexec paw ${command}\n`;
}

/**
 * Where the repo's config lives relative to its root.
 *
 * @param {string} root - The repo root.
 * @returns {string} The config path.
 */
export function configPathFor(root: string): string {
  return joinPath([root, '.paw', 'config.json']);
}

/**
 * Plan the files an attach writes into a repo root.
 *
 * The config is the one file that may already belong to someone, so what
 * happens to it is decided by {@link resolveInit} — every surface that can
 * attach a repository has to reach the same verdict. A refusal comes back as a
 * plan that writes no config, carrying the reason, instead of throwing: the
 * caller reports it and the git hook still has a plan.
 *
 * @param {string} root - The repo root.
 * @param {string | null} existingConfig - Current `.paw/config.json` contents, or null when absent.
 * @param {InitMode} mode - How the operator resolved a config conflict.
 * @returns {InitPlan} The files to write, and any refusal.
 * @throws {Error} When an existing config is present but unreadable.
 */
export function planInit(
  root: string,
  existingConfig: string | null = null,
  mode: InitMode = 'create',
): InitPlan {
  const outcome = resolveInit(existingConfig, DEFAULT_CONFIG, mode);
  const hookWrite: FileWrite = {
    path: joinPath([root, '.git', 'hooks', 'pre-commit']),
    content: hook('check --staged'),
    executable: true,
  };

  if (outcome.kind === 'refuse') {
    return { root, writes: [hookWrite], refusal: outcome };
  }

  return {
    root,
    writes: [
      {
        path: configPathFor(root),
        content: outcome.content,
        executable: false,
      },
      hookWrite,
    ],
  };
}
