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

import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
