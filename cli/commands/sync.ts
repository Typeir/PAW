/**
 * @fileoverview Sync command for the PAW CLI — calls pawSync directly.
 *
 * @module .github/PAW/cli/commands/sync
 */

import { log } from '@clack/prompts';
import { runPawSync } from '../../pawSync';
import type { CommandMeta } from '../cli-loader';

/** Command metadata for the fs-based loader. */
export const meta: CommandMeta = {
  name: 'sync',
  description: 'Regenerate hooks.json via adapter layer',
};

/**
 * Run PAW sync to regenerate hooks and hook configs.
 * @param args - CLI arguments (e.g. --force).
 */
export function run(args: string[]): void {
  // Forward --force flag via process.argv so pawSync picks it up
  if (args.includes('--force') && !process.argv.includes('--force')) {
    process.argv.push('--force');
  }
  runPawSync().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`Sync failed: ${msg}`);
    process.exit(1);
  });
}
