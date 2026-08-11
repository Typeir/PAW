/**
 * PAW Daemon (pawd)
 *
 * @fileoverview Process shell. Parse `argv`, start {@link runDaemon} on real
 * node runtime, print URL, stay up. Serve repo. `pawd` no argument serve
 * working dir, find its config and every plan in it. Plan path open only
 * that one. Hold no rules. Exclude from unit coverage as argv/stdout shell;
 * compose test to 100% unit and integration. Exit non-zero: plan the repo
 * does not hold, or plan-less module.
 *
 *   pawd                                  serve repo you stand in
 *   pawd --root=../other --port=8971      serve another repo, on chosen port
 *   pawd plans/lore.swarm.mjs             serve this repo, open on that plan
 *
 * @module @paw/daemon/main
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { consolePage } from './domain/consolePage.js';
import { identityNotice } from './infrastructure/identityStore.js';
import { nodeRuntime } from './infrastructure/nodeRuntime.js';
import { runDaemon } from './application/runDaemon.js';

/**
 * Daemon entrypoint.
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const value = (flag: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${flag}=`));
    return hit?.slice(flag.length + 3);
  };
  const [planPath] = argv.filter((a) => !a.startsWith('--'));
  const portArg = value('port');

  const daemon = await runDaemon(
    {
      root: value('root') ?? '.',
      configPath: value('config'),
      planPath,
      port: portArg === undefined ? 0 : Number(portArg),
    },
    nodeRuntime(consolePage()),
  );
  const notice = identityNotice(daemon.identity, new Date());
  process.stdout.write(
    `pawd listening on ${daemon.url}#t=${daemon.token}\n` +
      `  that URL carries this session's credential — treat it like a password\n` +
      `  repo: ${daemon.root}, ${daemon.plans.length} plan(s)` +
      `${daemon.openedOn === null ? '' : `, open on ${daemon.openedOn}`}\n` +
      notice.map((line) => `  ${line}\n`).join(''),
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
