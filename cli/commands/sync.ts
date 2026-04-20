/**
 * @fileoverview Sync command for the PAW CLI — delegates to pawSync.ts.
 *
 * @module .github/PAW/cli/commands/sync
 */

import { log } from '@clack/prompts';
import { execSync } from 'node:child_process';
import { PAW_TSCONFIG_REL, PROJECT_ROOT } from '../../paw-paths';
import type { CommandMeta } from '../cli-loader';

/** Command metadata for the fs-based loader. */
export const meta: CommandMeta = {
  name: 'sync',
  description: 'Regenerate hooks.json via adapter layer',
};

/**
 * Run pawSync.ts to regenerate hooks.json via the adapter layer.
 * @param args - CLI arguments forwarded to pawSync.ts (e.g. --force).
 */
export function run(args: string[]): void {
  const extra = args.length > 0 ? ` ${args.join(' ')}` : '';
  try {
    const output = execSync(
      `npx tsx --tsconfig ${PAW_TSCONFIG_REL} .github/PAW/pawSync.ts${extra}`,
      { cwd: PROJECT_ROOT, encoding: 'utf-8', stdio: 'pipe' },
    );
    process.stdout.write(output);
  } catch (err: unknown) {
    const msg =
      err instanceof Error
        ? ((err as { stderr?: string }).stderr ?? err.message)
        : String(err);
    log.error(`Sync failed: ${msg}`);
    process.exit(1);
  }
}
