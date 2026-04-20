/**
 * @fileoverview Gate management commands for the PAW CLI.
 * Delegates to pawGates.ts for execution, forwarding CLI flags.
 *
 * @module .github/PAW/cli/commands/gates
 */

import { log } from '@clack/prompts';
import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { GATES_DIR, PAW_TSCONFIG_REL, PROJECT_ROOT } from '../../paw-paths';
import type { CommandMeta } from '../cli-loader';
import { resolveSubcommand } from '../cli-loader';

/** Command metadata for the fs-based loader. */
export const meta: CommandMeta = {
  name: 'gates',
  aliases: ['g'],
  description: 'Manage and run quality gates',
  subcommands: {
    ls: {
      description: 'List discovered gates',
      aliases: ['list'],
      isDefault: true,
    },
    run: { description: 'Run quality gates (forwards flags to pawGates.ts)' },
  },
};

/**
 * List all discovered gate files in .paw/gates/.
 */
function cmdGatesList(): void {
  let files: string[];
  try {
    files = readdirSync(GATES_DIR).filter((f) => f.endsWith('.gate.ts'));
  } catch {
    log.warn(`No gates directory found at ${GATES_DIR}`);
    return;
  }

  if (files.length === 0) {
    log.info('No gates discovered.');
    return;
  }

  log.info(`${files.length} gate(s) in ${GATES_DIR}:`);
  for (const f of files) {
    log.message(`  ${f.replace('.gate.ts', '')}`);
  }
}

/**
 * Run quality gates by delegating to pawGates.ts.
 * All remaining CLI args are forwarded (e.g. --changed-only, --gates x, --staged).
 *
 * @param args - CLI arguments forwarded to pawGates.ts
 */
function cmdGatesRun(args: string[]): void {
  const extra = args.length > 0 ? ` ${args.join(' ')}` : '';
  try {
    const output = execSync(
      `npx tsx --tsconfig ${PAW_TSCONFIG_REL} .github/PAW/pawGates.ts${extra}`,
      { cwd: PROJECT_ROOT, encoding: 'utf-8', stdio: 'pipe' },
    );
    process.stdout.write(output);
  } catch (err: unknown) {
    const execErr = err as {
      stdout?: string;
      stderr?: string;
      status?: number;
    };
    if (execErr.stdout) process.stdout.write(execErr.stdout);
    if (execErr.stderr) process.stderr.write(execErr.stderr);
    process.exit(execErr.status ?? 1);
  }
}

/**
 * Dispatch subcommands for `paw gates`.
 *
 * @param args - Remaining argv after the command name.
 */
export function run(args: string[]): void {
  const sub = resolveSubcommand(meta, args[0]);

  switch (sub) {
    case 'ls':
      cmdGatesList();
      break;
    case 'run':
      cmdGatesRun(args.slice(1));
      break;
    default:
      log.error(`Unknown gates subcommand: ${args[0] ?? '(none)'}`);
  }
}
