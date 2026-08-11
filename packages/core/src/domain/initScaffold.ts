/**
 * PAW Init Scaffold
 *
 * @fileoverview What attaching PAW to repo write into it: a
 * host-agnostic `.paw/config.json` descriptor and a git hook that shell out to
 * globally-installed `paw` on PATH. No framework code copied — repo
 * declare where its gates, connectors, plans, and bindings live, and defer to
 * installed binary (decision doc 21).
 *
 * This policy defines what attaching a repository writes; it live in
 * domain because more than one surface can attach repository, and the
 * bytes written must not depend on which one do it. Pure — it return plan of
 * file writes and perform none, so exact bytes be a unit test.
 *
 * @module @paw/core/domain/initScaffold
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { resolveInit, type InitMode, type InitOutcome } from './initConfig.js';
import { joinPath } from './paths.js';

/**
 * Single file an attach write.
 *
 * @interface FileWrite
 * @property {string} path - Absolute path to write.
 * @property {string} content - File contents.
 * @property {boolean} executable - File need executable bit (git hooks).
 */
export interface FileWrite {
  readonly path: string;
  readonly content: string;
  readonly executable: boolean;
}

/**
 * Plan an attach produce for repo root.
 *
 * @interface InitPlan
 * @property {string} root - Repo root being attached.
 * @property {FileWrite[]} writes - Files to write.
 * @property {Extract<InitOutcome, { kind: 'refuse' }>} [refusal] - Present when existing config stop config write; rest of plan still stand.
 */
export interface InitPlan {
  readonly root: string;
  readonly writes: readonly FileWrite[];
  readonly refusal?: Extract<InitOutcome, { kind: 'refuse' }>;
}

/**
 * Host-agnostic descriptor written to `.paw/config.json`. Repo declares
 * where its own PAW artefacts live; installed binary read this — nothing is
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
 * Git hook body that defer to globally-installed `paw` on PATH. Fail the
 * commit only when `paw` fail; a missing `paw` fail the hook with an error.
 *
 * @param {string} command - `paw` subcommand to run.
 * @returns {string} Hook script.
 */
function hook(command: string): string {
  return `#!/bin/sh\n# Installed by \`paw init\`. Delegates to the global paw on PATH.\nexec paw ${command}\n`;
}

/**
 * Where repo config live relative to its root.
 *
 * @param {string} root - Repo root.
 * @returns {string} Config path.
 */
export function configPathFor(root: string): string {
  return joinPath([root, '.paw', 'config.json']);
}

/**
 * Plan files an attach write into repo root.
 *
 * Config be one file that may already exist (written by another tool),
 * so what happen to it decided by {@link resolveInit} — every surface
 * that can attach repository must reach same verdict. Refusal return as a
 * plan that write no config and carry reason: caller report it and git
 * hook still have plan.
 *
 * @param {string} root - Repo root.
 * @param {string | null} existingConfig - Current `.paw/config.json` contents, or null when absent.
 * @param {InitMode} mode - How operator resolved config conflict.
 * @returns {InitPlan} Files to write, and any refusal.
 * @throws {Error} When existing config present but unreadable.
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
