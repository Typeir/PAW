/**
 * @fileoverview E2E test for `doctor` and `swarm` command. Spawn `main.ts` as
 * real process on fixture files — config doctor validates and `.swarm.mjs`
 * plan router import dynamic — then check printed report and exit code. E2E
 * tier from CONSTRAINTS.md Constraint 1, cover process shell, file loaders,
 * dynamic import in `main.ts`. Fail-loud assert: unknown command and plan-less
 * module both exit non-zero.
 *
 * @module @paw/cli/test/e2e/cli
 */

import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..', '..');
const TSX = join(PKG, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const MAIN = join(PKG, 'src', 'infrastructure', 'main.ts');
const FIX = join(HERE, '..', 'fixtures');

/**
 * Run CLI as child process in `cwd` with given argv, resolve with stdout,
 * stderr, exit code.
 *
 * @param cwd - Directory to run in.
 * @param args - The argv after the script path.
 */
function runCliIn(
  cwd: string,
  ...args: string[]
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [TSX, MAIN, ...args], { cwd }, (err, stdout, stderr) => {
      const code = err && typeof err.code === 'number' ? err.code : 0;
      resolve({ stdout, stderr, code });
    });
  });
}

/**
 * Run CLI as child process with given argv, resolve with stdout, stderr, exit
 * code.
 *
 * @param args - The argv after the script path.
 */
function runCli(
  ...args: string[]
): Promise<{ stdout: string; stderr: string; code: number }> {
  return runCliIn(PKG, ...args);
}

/**
 * Temporary repository holding `.paw/config.json` with the given bindings.
 *
 * @param config - Config document to write.
 */
function repoWithConfig(config: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'paw-e2e-'));
  mkdirSync(join(root, '.paw'), { recursive: true });
  writeFileSync(join(root, '.paw', 'config.json'), JSON.stringify(config), 'utf8');
  return root;
}

describe('cli help (e2e)', () => {
  it('prints the command list for bare paw and for help, exit 0', async () => {
    for (const argv of [[], ['help'], ['--help']] as string[][]) {
      const { stdout, code } = await runCli(...argv);
      expect(code).toBe(0);
      expect(stdout).toContain('usage: paw <command> [args]');
      expect(stdout).toContain('swarm doctor|show|run');
    }
  });

  it('tells doctor callers the config argument it needs, exit 1', async () => {
    const { stderr, code } = await runCli('doctor');
    expect(code).toBe(1);
    expect(stderr).toContain('paw doctor <config.json>');
  });
});

describe('cli doctor (e2e)', () => {
  it('reports a ready install, exit 0', async () => {
    const { stdout, code } = await runCli('doctor', join(FIX, 'ready.config.json'));
    expect(code).toBe(0);
    expect(stdout).toContain('doctor: ready');
    expect(stdout).toContain('role edit.apply → ds-flash');
  });

  it('reports an unready install and exits 1', async () => {
    const { stdout, code } = await runCli('doctor', join(FIX, 'broken.config.json'));
    expect(code).toBe(1);
    expect(stdout).toContain('doctor: NOT READY');
    expect(stdout).toContain('config.connector');
    expect(stdout).toContain('review.judge');
  });
});

describe('cli swarm (e2e)', () => {
  const plan = () => join(FIX, 'demo.swarm.mjs');

  it('validates a clean plan, exit 0', async () => {
    const { stdout, code } = await runCli('swarm', 'doctor', plan());
    expect(code).toBe(0);
    expect(stdout).toContain('plan demo: ok');
    expect(stdout).toContain('✓ file-conflict');
  });

  it('says the role binding went unchecked without --live, rather than passing it silently', async () => {
    const { stdout, code } = await runCli('swarm', 'doctor', plan());
    expect(code).toBe(0);
    expect(stdout).toContain('role-binding — edit.apply — not checked; pass --live');
  });

  it('renders one member brief', async () => {
    const { stdout, code } = await runCli('swarm', 'show', plan(), '1');
    expect(code).toBe(0);
    expect(stdout).toContain('── demo · member 1 ──');
    expect(stdout).toContain('Edit docs/two.mdx.');
  });

  it('shows the attached context in the dry-run, exactly as dispatch would send it', async () => {
    const { stdout, code } = await runCli(
      'swarm',
      'show',
      plan(),
      '1',
      '--context',
      'test/fixtures/context.md',
    );
    expect(code).toBe(0);
    expect(stdout).toContain('Edit docs/two.mdx.');
    expect(stdout).toContain('## Attached context');
    expect(stdout).toContain('### test/fixtures/context.md');
    expect(stdout).toContain('house style: be terse');
  });

  it('attaches files to a real run and says how many', async () => {
    const { stdout, code } = await runCli(
      'swarm',
      'run',
      plan(),
      '--context',
      'test/fixtures/context.md',
    );
    expect(code).toBe(0);
    expect(stdout).toContain('attaching 1 file(s) to every brief: test/fixtures/context.md');
    expect(stdout).toContain('herd: 2 done');
  });

  it('expands a --context glob and refuses one that matches nothing', async () => {
    const hit = await runCli('swarm', 'show', plan(), '0', '--context=test/fixtures/*.md');
    expect(hit.code).toBe(0);
    expect(hit.stdout).toContain('### test/fixtures/context.md');

    const miss = await runCli('swarm', 'run', plan(), '--context=test/fixtures/*.zzz');
    expect(miss.code).toBe(1);
    expect(miss.stderr).toContain('--context pattern matched no files');
  });

  it('releases the herd with a fake model, exit 0', async () => {
    const { stdout, code } = await runCli('swarm', 'run', plan());
    expect(code).toBe(0);
    expect(stdout).toContain('herd: 2 done · 0 skipped');
    expect(stdout).toContain('✓ member 0 (docs/one.mdx)');
  });

  it('proves every declared target actually landed, not just that members settled', async () => {
    const { stdout, code } = await runCli('swarm', 'run', plan());
    expect(code).toBe(0);
    expect(stdout).toContain('targets: 2 proved · 0 unproved');
  });

  it('calls targets unenforced when the plan declares none, rather than reporting a clean run', async () => {
    const { stdout, code } = await runCli(
      'swarm',
      'run',
      join(FIX, 'undeclared.plan.mjs'),
    );
    expect(code).toBe(0);
    expect(stdout).toContain('herd: 2 done · 0 skipped');
    expect(stdout).toContain('targets: not enforced — no member that ran declares expectFiles');
  });

  it('rejects an unknown swarm subcommand, exit 1', async () => {
    const { stderr, code } = await runCli('swarm', 'stampede', plan());
    expect(code).toBe(1);
    expect(stderr).toContain('unknown swarm subcommand "stampede"');
  });
});

describe('cli routing (e2e)', () => {
  it('rejects an unknown command, exit 1, pointing at help', async () => {
    const { stderr, code } = await runCli('gallop');
    expect(code).toBe(1);
    expect(stderr).toContain('unknown command "gallop"');
    expect(stderr).toContain('paw help');
  });

  it('fails loud when a module exports no plan, exit 1', async () => {
    const { stderr, code } = await runCli('swarm', 'doctor', join(FIX, 'not-a-plan.mjs'));
    expect(code).toBe(1);
    expect(stderr).toContain('does not export a swarm plan');
  });

  it('fails a broken hook open: do-nothing output, exit 0, the reason on stderr', async () => {
    const { stdout, stderr, code } = await runCli('hook');
    expect(code).toBe(0);
    expect(stdout).toBe(JSON.stringify({ continue: true }));
    expect(stderr).toContain('paw hook needs a host and event');
    expect(stderr).toContain('allowed without enforcement');
  });
});

describe('cli config show (e2e)', () => {
  const CHEAP = {
    contextTokens: 128_000,
    maxOutputTokens: 8_192,
    tools: true,
    structuredOutput: true,
    reasoning: true,
    vision: false,
    costClass: 'cheap',
  };
  const ROOMY = { ...CHEAP, maxOutputTokens: 16_384, costClass: 'standard' };

  /**
   * Config binding both cheap roles to `deepseek-chat` and `review.judge` to
   * whichever model the case is about.
   *
   * @param judge - Model id to bind `review.judge` to.
   * @param models - Declared models.
   */
  const configFor = (judge: string, models: Record<string, unknown>): unknown => ({
    models,
    roles: {
      'edit.apply': 'deepseek-chat',
      'review.graze': 'deepseek-chat',
      'review.judge': judge,
    },
  });

  it('marks every satisfied binding and exits 0', async () => {
    const root = repoWithConfig(
      configFor('deepseek-roomy', { 'deepseek-chat': CHEAP, 'deepseek-roomy': ROOMY }),
    );
    const { stdout, code } = await runCliIn(root, 'config', 'show');
    expect(code).toBe(0);
    expect(stdout).toContain('✓ role edit.apply → deepseek-chat');
    expect(stdout).toContain('✓ role review.judge → deepseek-roomy');
    expect(stdout).not.toContain('cannot run');
  });

  it('refuses a binding whose model the config does not declare', async () => {
    const root = repoWithConfig(
      configFor('deepseek-reasoner', { 'deepseek-chat': CHEAP }),
    );
    const { stdout, code } = await runCliIn(root, 'config', 'show');
    expect(code).toBe(1);
    expect(stdout).toContain(
      '✗ role review.judge → deepseek-reasoner — model "deepseek-reasoner" is not declared',
    );
    expect(stdout).toContain('1 required role(s) cannot run: review.judge');
  });

  it('refuses a declared model whose output ceiling falls short of the role', async () => {
    const root = repoWithConfig(configFor('deepseek-chat', { 'deepseek-chat': CHEAP }));
    const { stdout, code } = await runCliIn(root, 'config', 'show');
    expect(code).toBe(1);
    expect(stdout).toContain(
      '✗ role review.judge → deepseek-chat — max output 8192 < required 16384',
    );
  });
});

describe('cli modules install (e2e)', () => {
  /**
   * Run git with a throwaway identity.
   *
   * @param cwd - Directory to run in.
   * @param args - Git arguments.
   */
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', ['-c', 'user.name=paw', '-c', 'user.email=paw@example.invalid', ...args], {
      cwd,
      encoding: 'utf8',
    });

  /** Local git repo standing in for the paw-agile remote, shipping one skill on `main`. */
  const moduleSource = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'paw-module-src-'));
    git(dir, 'init', '-q', '-b', 'main');
    writeFileSync(join(dir, 'package.json'), '{"name":"@paw/agile"}', 'utf8');
    mkdirSync(join(dir, 'skills', 'paw-tasks'), { recursive: true });
    writeFileSync(join(dir, 'skills', 'paw-tasks', 'SKILL.md'), '---\nname: paw-tasks\n---\nread tasks\n', 'utf8');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'module');
    return dir;
  };

  /** Consumer repository: a git repo holding a PAW config. */
  const consumer = (): string => {
    const root = repoWithConfig({});
    git(root, 'init', '-q');
    return root;
  };

  it('places the module skill in .claude/skills, keeps it out of git, and removes it on uninstall', async () => {
    const src = moduleSource();
    const root = consumer();
    const skill = join(root, '.claude', 'skills', 'paw-tasks');

    const installed = await runCli('modules', 'install', 'paw-agile', `--from=${src}`, `--root=${root}`);
    expect(installed.code).toBe(0);
    expect(installed.stdout).toContain('modules: skill paw-tasks → .claude/skills/paw-tasks');
    expect(readFileSync(join(skill, 'SKILL.md'), 'utf8')).toContain('read tasks');
    expect(readFileSync(join(skill, '.paw-module'), 'utf8').trim()).toBe('paw-agile');
    expect(readFileSync(join(root, '.git', 'info', 'exclude'), 'utf8')).toContain('/.claude/skills/paw-tasks/');
    expect(git(root, 'status', '--porcelain')).not.toContain('.claude');

    const removed = await runCli('modules', 'uninstall', 'paw-agile', `--root=${root}`);
    expect(removed.code).toBe(0);
    expect(removed.stdout).toContain('modules: removed skill .claude/skills/paw-tasks');
    expect(existsSync(skill)).toBe(false);
    expect(readFileSync(join(root, '.git', 'info', 'exclude'), 'utf8')).not.toContain('/.claude/skills/paw-tasks/');
  }, 60000);

  it('leaves a skill folder PAW did not place untouched, and says why', async () => {
    const src = moduleSource();
    const root = consumer();
    const skill = join(root, '.claude', 'skills', 'paw-tasks');
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, 'SKILL.md'), 'mine', 'utf8');

    const installed = await runCli('modules', 'install', 'paw-agile', `--from=${src}`, `--root=${root}`);
    expect(installed.code).toBe(0);
    expect(installed.stdout).toContain(
      'modules: skill paw-tasks not placed — .claude/skills/paw-tasks already exists and PAW did not place it',
    );
    expect(readFileSync(join(skill, 'SKILL.md'), 'utf8')).toBe('mine');
  }, 60000);
});

describe('cli tasks sync (e2e)', () => {
  const PACKAGES = join(PKG, '..');

  /**
   * Serve one work package collection page on loopback until closed.
   *
   * @param body - Collection JSON.
   */
  const serve = (body: unknown): Promise<{ origin: string; close: () => void }> =>
    new Promise((resolve) => {
      const server = createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/hal+json' });
        res.end(JSON.stringify(body));
      });
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        resolve({ origin: `http://127.0.0.1:${port}`, close: () => server.close() });
      });
    });

  it('says how to enable a backend when none is, exit 1', async () => {
    const root = repoWithConfig({ modules: ['paw-agile'] });
    const { stdout, code } = await runCli('tasks', 'sync', `--root=${root}`);
    expect(code).toBe(1);
    expect(stdout).toContain('tasks sync: no backend connector is enabled');
  });

  it('pulls through the installed module into .paw/tasks.json, which paw tasks then renders', async () => {
    const root = repoWithConfig({ modules: ['paw-agile', 'paw-openproject'], connectors: ['openproject'] });
    mkdirSync(join(root, '.paw', 'modules'), { recursive: true });
    symlinkSync(join(PACKAGES, 'agile'), join(root, '.paw', 'modules', 'paw-agile'), 'junction');
    symlinkSync(join(PACKAGES, 'openproject'), join(root, '.paw', 'modules', 'paw-openproject'), 'junction');
    const element = (id: number, subject: string, parent: number | null, storyPoints: number | null) => ({
      id,
      subject,
      updatedAt: '2026-10-28T15:00:00.000Z',
      storyPoints,
      _links: { parent: { href: parent === null ? null : `/api/v3/work_packages/${parent}` } },
    });
    const server = await serve({
      total: 2,
      _embedded: { elements: [element(1, 'Checkout epic', null, null), element(2, 'Pay with card', 1, 5)] },
    });
    try {
      writeFileSync(
        join(root, '.paw', 'openproject.backend.env'),
        `BASE_URL=${server.origin}\nKEY=test-key\nPROJECT=demo\n`,
        'utf8',
      );
      const synced = await runCli('tasks', 'sync', `--root=${root}`);
      expect(synced.stdout).toContain('tasks sync: openproject full, 2 pulled, 0 removed');
      expect(synced.code).toBe(0);
      expect(JSON.parse(readFileSync(join(root, '.paw', 'openproject.sync.json'), 'utf8'))).toMatchObject({
        cursor: '2026-10-28T15:00:00.000Z',
      });
      const listed = await runCli('tasks', `--root=${root}`);
      expect(listed.code).toBe(0);
      expect(listed.stdout).toContain('tasks: 2 in the graph');
      expect(listed.stdout).toMatch(/op-1 {2}Checkout epic {2}↑ — {2}↓ op-2 {2}5/);
    } finally {
      server.close();
    }
  }, 60000);
});
