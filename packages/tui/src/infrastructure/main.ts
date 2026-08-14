/**
 * PAW TUI
 *
 * @fileoverview Process shell: a clack-driven menu over the same loaders the
 * CLI verbs use. The TUI is a guided front for people learning the CLI — each
 * action prints its result and then the CLI command that does the same thing.
 * Two input modes: interactive clack prompts on a TTY; on piped stdin, action
 * ids (`doctor plan herd gates daemon config quit`) fold in order and print
 * plain — the path E2E drives. Excluded from unit coverage (process I/O,
 * dynamic import, prompts); the line builders it prints are covered in
 * `domain/menu.ts`.
 *
 * @module @paw/tui/infrastructure/main
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { intro, isCancel, log, note, outro, select, spinner } from '@clack/prompts';
import {
  BUILTIN_ROLES,
  buildRegistry,
  clearBinding,
  connectorRoster,
  dispatchSwarm,
  memberCount,
  planKey,
  runDoctor,
  setBinding,
  type ConfigDocumentPort,
  type HealthReport,
  type ModelCapabilities,
  type ModelPort,
  type RoleRegistry,
  type SwarmPlan,
  type Violation,
} from '@paw/core';
import { ansiPaint } from '@paw/cosmetics';
import { createNodeConfigDocument, createNodeFileReader, createNodeGateRunner } from '@paw/adapters';
import { rpcCall, socketPath, tokenPath } from '@paw/daemon';
import {
  MENU,
  configLines,
  connectorLines,
  daemonLines,
  doctorLines,
  gatesLines,
  herdLines,
  planLines,
  type ActionId,
  type ConfigSnapshot,
  type DaemonSnapshot,
  type DaemonStatus,
  type MenuEntry,
  type TuiData,
} from '../domain/menu.js';

const KNOWN_CONNECTORS = ['copilot-hooks'];

const NOOP_PORT: ModelPort = {
  complete: async () => ({ content: '', inputTokens: 0, outputTokens: 0 }),
};

const FULL_CAPS: ModelCapabilities = {
  contextTokens: 200_000,
  maxOutputTokens: 32_000,
  tools: true,
  structuredOutput: true,
  reasoning: true,
  vision: true,
  costClass: 'trivial',
};

/**
 * Load and parse JSON config file.
 *
 * @param {string} path - Path to config.
 */
async function loadConfig(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

/**
 * Dynamically import swarm plan, throw if no `default` or `plan` export.
 *
 * @param {string} path - Path to plan module.
 */
async function loadPlan(path: string): Promise<SwarmPlan<unknown>> {
  const mod = (await import(pathToFileURL(resolve(path)).href)) as {
    default?: SwarmPlan<unknown>;
    plan?: SwarmPlan<unknown>;
  };
  const plan = mod.default ?? mod.plan;
  if (!plan || typeof plan.brief !== 'function') {
    throw new Error(`"${path}" does not export a swarm plan`);
  }
  return plan;
}

/**
 * Build registry binding plan's role to deterministic fake model.
 *
 * @param {SwarmPlan<unknown>} plan - The plan being run.
 */
function fakeRegistryFor(plan: SwarmPlan<unknown>): RoleRegistry {
  const model: ModelPort = {
    complete: async (req) => ({
      content: `ran: ${req.prompt.split('\n')[0]}`,
      inputTokens: req.prompt.length,
      outputTokens: 1,
    }),
  };
  return buildRegistry(
    { models: { fake: FULL_CAPS }, roles: { [plan.role]: 'fake' } },
    () => model,
  );
}

/**
 * Load everything read-only actions print: doctor report and dry-run herd.
 *
 * @param {string} configPath - Path to config.
 * @param {string} planPath - Path to plan.
 */
async function loadData(configPath: string, planPath: string): Promise<TuiData> {
  const config = await loadConfig(configPath);
  const plan = await loadPlan(planPath);
  const doctor = runDoctor(
    config,
    buildRegistry(config, () => NOOP_PORT),
    KNOWN_CONNECTORS,
  );
  const herd = await dispatchSwarm(plan, {
    registry: fakeRegistryFor(plan),
    files: createNodeFileReader(process.cwd()),
  });
  return { doctor, plan, herd };
}

/**
 * Working-tree change set: unstaged, staged, untracked files.
 *
 * @param {string} root - Repository root.
 * @returns {string[]} Deduped, slash-normalised paths.
 */
function changedFiles(root: string): string[] {
  const git = (args: string[]): string[] => {
    try {
      return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
        .split('\n')
        .map((line) => line.trim().replace(/\\/g, '/'))
        .filter((line) => line.length > 0);
    } catch {
      return [];
    }
  };
  return [
    ...new Set([
      ...git(['diff', '--name-only', 'HEAD']),
      ...git(['diff', '--cached', '--name-only']),
      ...git(['ls-files', '--others', '--exclude-standard']),
    ]),
  ];
}

/**
 * Daemon endpoint and handshake token for repository — same addressing the
 * CLI daemon and violations verbs use.
 *
 * @param {string} root - Repository root.
 * @returns {{ endpoint: string; token: string }} Socket path and token path.
 */
function daemonEndpoint(root: string): { endpoint: string; token: string } {
  return {
    endpoint: socketPath(root, {
      platform: process.platform,
      xdgRuntimeDir: process.env.XDG_RUNTIME_DIR,
      tmpdir: tmpdir(),
    }),
    token: tokenPath(resolve(root, '.paw')),
  };
}

/**
 * Read daemon's status and held violations into one snapshot. Either call
 * resolving null (no daemon) yield not-running snapshot.
 *
 * @param {string} root - Repository root.
 * @returns {Promise<DaemonSnapshot>} The snapshot.
 */
async function daemonSnapshot(root: string): Promise<DaemonSnapshot> {
  const { endpoint, token } = daemonEndpoint(root);
  const status = (await rpcCall(endpoint, token, 'daemon.status', {})) as DaemonStatus | null;
  const listed = (await rpcCall(endpoint, token, 'violations.list', {})) as
    | { violations?: Violation[] }
    | null;
  return { status, violations: listed?.violations ?? [] };
}

/**
 * Read repo's declared models and every role's binding into snapshot.
 *
 * @param {ConfigDocumentPort} doc - Config document.
 * @returns {Promise<ConfigSnapshot>} Models and bindings.
 */
async function readConfigSnapshot(doc: ConfigDocumentPort): Promise<ConfigSnapshot> {
  const config = await doc.read();
  return {
    models: Object.keys(config.models ?? {}),
    bindings: BUILTIN_ROLES.map((role) => ({
      role: role.id,
      bound: config.roles?.[role.id] ?? null,
    })),
  };
}

/**
 * The teach line an action ends with: the CLI command doing the same thing.
 *
 * @param {MenuEntry} entry - The action's menu entry.
 * @param {boolean} colored - Paint with the shared palette.
 * @returns {string | null} The line, or null for actions with no CLI twin.
 */
function cliLine(entry: MenuEntry, colored: boolean): string | null {
  if (entry.cli === null) {
    return null;
  }
  const text = `cli: ${entry.cli}`;
  return colored ? ansiPaint.flag(text) : text;
}

/**
 * Run one action to its printed lines. Interactive mode may prompt (member
 * pick, daemon verb, binding edit); batch keeps the defaults: member 0, daemon
 * status, config read-only.
 *
 * @param {ActionId} id - The action.
 * @param {TuiData} data - Loaded read-only data.
 * @param {string} root - Repository root.
 * @param {boolean} interactive - Whether prompts may open.
 * @returns {Promise<string[]>} Lines to print.
 */
async function runAction(
  id: ActionId,
  data: TuiData,
  root: string,
  interactive: boolean,
): Promise<string[]> {
  if (id === 'doctor') {
    return doctorLines(data.doctor);
  }
  if (id === 'plan') {
    let member = 0;
    const count = memberCount(data.plan);
    if (interactive && count > 1) {
      const picked = await select({
        message: 'which member?',
        options: Array.from({ length: count }, (_v, m) => ({
          value: m,
          label: `member ${m}`,
          hint: planKey(data.plan, m),
        })),
      });
      if (isCancel(picked)) {
        return [];
      }
      member = picked;
    }
    return planLines(data.plan, member);
  }
  if (id === 'herd') {
    return herdLines(data.herd);
  }
  if (id === 'gates') {
    let report: HealthReport;
    if (interactive) {
      const wait = spinner();
      wait.start('running gates on working-tree changes');
      report = await createNodeGateRunner(root).runForFiles(changedFiles(root));
      wait.stop('gates ran');
    } else {
      report = await createNodeGateRunner(root).runForFiles(changedFiles(root));
    }
    return gatesLines(report);
  }
  if (id === 'daemon') {
    let verb: 'status' | 'restart' | 'prune' | 'stop' = 'status';
    if (interactive) {
      const picked = await select({
        message: 'daemon action?',
        options: [
          { value: 'status', label: 'status', hint: 'cli: paw daemon status' },
          { value: 'restart', label: 'restart', hint: 'cli: paw daemon restart' },
          { value: 'prune', label: 'prune violations', hint: 'cli: paw violations --prune' },
          { value: 'stop', label: 'stop', hint: 'cli: paw daemon stop' },
        ] as const,
      });
      if (isCancel(picked)) {
        return [];
      }
      verb = picked;
    }
    const { endpoint, token } = daemonEndpoint(root);
    if (verb === 'restart') {
      try {
        execFileSync('paw', ['daemon', 'restart'], { cwd: root, stdio: 'ignore', shell: true });
      } catch {
        // A failed restart just leaves the snapshot showing not-running.
      }
    }
    if (verb === 'stop') {
      await rpcCall(endpoint, token, 'daemon.stop', {});
      return daemonLines({ status: null, violations: [] });
    }
    if (verb === 'prune') {
      await rpcCall(endpoint, token, 'violations.prune', {});
    }
    return daemonLines(await daemonSnapshot(root));
  }
  if (id === 'connectors') {
    return connectorLines(connectorRoster(await createNodeConfigDocument(root).read()));
  }
  // config
  const doc = createNodeConfigDocument(root);
  if (interactive) {
    const snapshot = await readConfigSnapshot(doc);
    const picked = await select({
      message: 'bindings — edit one?',
      options: [
        { value: '(view)', label: 'just show them', hint: 'cli: paw config' },
        ...snapshot.bindings.map((binding) => ({
          value: binding.role,
          label: `${binding.role} → ${binding.bound ?? '(unbound)'}`,
          hint: 'rebind or unbind',
        })),
      ],
    });
    if (isCancel(picked)) {
      return [];
    }
    if (picked !== '(view)') {
      const target = await select({
        message: `bind ${picked} to`,
        options: [
          ...snapshot.models.map((model) => ({ value: model, label: model })),
          { value: '(unbind)', label: '(unbind)', hint: 'cli: paw config unbind' },
        ],
      });
      if (!isCancel(target)) {
        const current = await doc.read();
        const edit =
          target === '(unbind)'
            ? clearBinding(current, picked)
            : setBinding(current, picked, target);
        if (edit.ok) {
          await doc.write(edit.config);
        }
      }
    }
  }
  return configLines(await readConfigSnapshot(doc));
}

/**
 * The clack loop: pick an action, print its lines and its CLI twin, repeat
 * until quit or cancel.
 *
 * @param {TuiData} data - Loaded read-only data.
 * @param {string} root - Repository root.
 * @param {string} planPath - Discovered or given plan, for the intro line.
 */
async function runInteractive(data: TuiData, root: string, planPath: string): Promise<void> {
  const colored = process.env.NO_COLOR === undefined;
  intro(
    `${colored ? ansiPaint.verb('paw') : 'paw'} · ${
      colored ? ansiPaint.concept(planPath) : planPath
    }`,
  );
  for (;;) {
    const choice = await select({
      message: 'what do you want?',
      options: MENU.map((entry) => ({ value: entry.id, label: entry.label, hint: entry.hint })),
    });
    if (isCancel(choice) || choice === 'quit') {
      break;
    }
    const entry = MENU.find((candidate) => candidate.id === choice) as MenuEntry;
    const lines = await runAction(choice, data, root, true);
    if (lines.length > 0) {
      note(lines.join('\n'), entry.label);
    }
    const teach = cliLine(entry, colored);
    if (teach !== null) {
      log.message(teach);
    }
  }
  outro('paw help lists every command');
}

/**
 * Batch mode: whitespace-separated action ids off stdin, printed plain in
 * order — the deterministic path E2E drives. An unknown id fails loud.
 *
 * @param {TuiData} data - Loaded read-only data.
 * @param {string} root - Repository root.
 */
async function runBatch(data: TuiData, root: string): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const tokens = Buffer.concat(chunks).toString('utf8').split(/\s+/).filter((t) => t.length > 0);
  for (const token of tokens) {
    if (token === 'quit') {
      return;
    }
    const entry = MENU.find((candidate) => candidate.id === token);
    if (entry === undefined) {
      throw new Error(`unknown action "${token}" — actions: ${MENU.map((m) => m.id).join(' ')}`);
    }
    const lines = await runAction(entry.id, data, root, false);
    process.stdout.write(`── ${entry.label} ──\n${lines.join('\n')}\n`);
    const teach = cliLine(entry, false);
    if (teach !== null) {
      process.stdout.write(`${teach}\n`);
    }
  }
}

/**
 * First `.swarm.mjs` under a root, alphabetical, skipping dependency and
 * output directories. Null when the tree holds none.
 *
 * @param {string} root - Directory to walk.
 * @returns {string | null} Plan path, or null.
 */
function discoverPlan(root: string): string | null {
  const skip = new Set(['node_modules', '.git', 'dist', 'coverage']);
  const queue = [root];
  const found: string[] = [];
  while (queue.length > 0) {
    const dir = queue.shift() as string;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) {
          queue.push(join(dir, entry.name));
        }
      } else if (entry.name.endsWith('.swarm.mjs')) {
        found.push(join(dir, entry.name));
      }
    }
  }
  found.sort();
  return found[0] ?? null;
}

/**
 * TUI entrypoint. With no arguments it works like the other verbs: config from
 * `.paw/config.json` under the working directory, plan the first `.swarm.mjs`
 * found in the tree. Explicit arguments override either.
 */
async function main(): Promise<void> {
  const [configArg, planArg] = process.argv.slice(2);
  const cwd = process.cwd();
  const configPath = configArg ?? join(cwd, '.paw', 'config.json');
  if (!existsSync(configPath)) {
    throw new Error(
      `no config at ${configPath} — run \`paw init\` to attach this repository, ` +
        'or pass one: usage: paw tui [config.json] [plan.swarm.mjs]',
    );
  }
  const planPath = planArg ?? discoverPlan(cwd);
  if (planPath === null) {
    throw new Error(
      'no .swarm.mjs plan found under this directory — ' +
        'pass one: usage: paw tui [config.json] [plan.swarm.mjs]',
    );
  }
  const data = await loadData(configPath, planPath);
  if (process.stdin.isTTY) {
    await runInteractive(data, cwd, planPath);
  } else {
    await runBatch(data, cwd);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
