/**
 * PAW Daemon (pawd)
 *
 * @fileoverview The process shell: parse `argv`, start {@link runDaemon} on the
 * real node runtime, print the URL, and stay up. It serves a repository —
 * `pawd` with no arguments serves the working directory, discovering its config
 * and every plan in it; a plan path is only the one to open on. It holds no
 * rules, and is excluded from unit coverage as the argv/stdout shell; what it
 * composes is unit- and integration-tested to 100%. Fails loud: a plan the repo
 * does not hold, or a plan-less module, exits non-zero.
 *
 *   pawd                                  serve the repo you are standing in
 *   pawd --root=../other --port=8971      serve another repo, on a chosen port
 *   pawd plans/lore.swarm.mjs             serve this repo, open on that plan
 *
 * @module @paw/daemon/main
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { consolePage } from './consolePage.js';
import { identityNotice } from './identityStore.js';
import { nodeRuntime } from './nodeRuntime.js';
import { runDaemon } from './serve.js';

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
