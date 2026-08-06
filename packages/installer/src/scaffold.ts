/**
 * PAW Installer Init Scaffold
 *
 * @fileoverview Computes what `paw init` writes into a target repo to attach the
 * globally-installed PAW to it — a host-agnostic `.paw/config.json` descriptor and
 * git hooks that shell out to the global `paw` on PATH. It copies no framework
 * code: the repo only declares where its gates, connectors, plans, and bindings
 * live, and defers to the installed binary (decision doc 21). Pure — it returns a
 * plan of file writes; `main.ts` performs them — so the exact bytes written are a
 * unit test.
 *
 * @module @paw/installer/scaffold
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { join } from 'node:path';

/**
 * A single file `paw init` will write.
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
 * The plan `paw init` produces for a repo root.
 *
 * @interface InitPlan
 * @property {string} root - The repo root being attached.
 * @property {FileWrite[]} writes - The files to write.
 */
export interface InitPlan {
  readonly root: string;
  readonly writes: readonly FileWrite[];
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
 * Plan the files `paw init` writes to attach PAW to a repo root.
 *
 * @param {string} root - The repo root (from {@link findRepoRoot}).
 * @returns {InitPlan} The files to write.
 */
export function planInit(root: string): InitPlan {
  return {
    root,
    writes: [
      {
        path: join(root, '.paw', 'config.json'),
        content: `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`,
        executable: false,
      },
      {
        path: join(root, '.git', 'hooks', 'pre-commit'),
        content: hook('check --staged'),
        executable: true,
      },
    ],
  };
}
