/**
 * Module Install Tests
 *
 * @fileoverview Cover planning — unknown id, a module already present, the
 * catalogue source and the `--from` override — and the two git steps, with a
 * fake process reporting each failure the install must surface. Uninstall
 * planning covers the same unknown-id refusal, nothing-to-remove, and the
 * still-enabled guard that keeps config from pointing at a directory about to
 * disappear.
 *
 * @module @paw/core/test/application/moduleInstall
 */

import { describe, expect, it } from 'vitest';
import {
  MODULES_DIR,
  planInstall,
  planUninstall,
  runInstall,
} from '../../src/application/moduleInstall.js';
import type { ProcessPort, ProcessResult } from '../../src/ports/index.js';

/**
 * Fake git that answers each call in turn and records what it was asked.
 *
 * @param {readonly Partial<ProcessResult>[]} answers - One answer per call.
 * @returns {{ port: ProcessPort; calls: string[][] }} The port and its log.
 */
function fakeGit(answers: readonly Partial<ProcessResult>[]): {
  port: ProcessPort;
  calls: string[][];
} {
  const calls: string[][] = [];
  let turn = 0;
  const port: ProcessPort = {
    run: async (command, args) => {
      calls.push([command, ...args]);
      const answer = answers[turn] ?? {};
      turn += 1;
      return { stdout: '', stderr: '', code: 0, ...answer };
    },
    spawnDetached: async () => 0,
  };
  return { port, calls };
}

/** A planned install, for the runner tests. */
const PLAN = {
  ok: true as const,
  id: 'paw-agile',
  source: '/src/paw-agile',
  ref: 'main',
  target: `${MODULES_DIR}/paw-agile`,
};

describe('planInstall', () => {
  it('plans a clone from the catalogue at the pinned ref', () => {
    const plan = planInstall('paw-agile', undefined, false);
    expect(plan).toMatchObject({
      ok: true,
      id: 'paw-agile',
      ref: 'main',
      target: '.paw/modules/paw-agile',
    });
    expect(plan.ok === true && plan.source).toContain('paw-agile');
  });

  it('takes a source override, which is how a module installs before it has a remote', () => {
    const plan = planInstall('paw-agile', '../paw-agile', false);
    expect(plan).toMatchObject({ ok: true, source: '../paw-agile' });
  });

  it('refuses an unknown id naming the catalogue', () => {
    const plan = planInstall('paw-billing', undefined, false);
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.reason).toContain('paw-agile');
  });

  it('refuses to overwrite a module already installed', () => {
    const plan = planInstall('paw-agile', undefined, true);
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.reason).toContain('already installed');
  });
});

describe('planUninstall', () => {
  it('plans removal of an installed, disabled module', () => {
    const plan = planUninstall('paw-agile', false, true);
    expect(plan).toEqual({ ok: true, id: 'paw-agile', target: '.paw/modules/paw-agile' });
  });

  it('refuses an unknown id naming the catalogue', () => {
    const plan = planUninstall('paw-billing', false, true);
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.reason).toContain('paw-agile');
  });

  it('refuses when nothing is installed', () => {
    const plan = planUninstall('paw-agile', false, false);
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.reason).toContain('not installed');
  });

  it('refuses while the module is still enabled, naming the disable verb', () => {
    const plan = planUninstall('paw-agile', true, true);
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.reason).toBe(
      'module "paw-agile" is still enabled; disable it first with paw modules disable paw-agile',
    );
  });

  it('checks presence before enabled state, so an enabled-but-uninstalled module reads as nothing to remove', () => {
    const plan = planUninstall('paw-agile', true, false);
    expect(plan.ok === false && plan.reason).toContain('not installed');
  });
});

describe('runInstall', () => {
  it('clones then checks out the pinned ref, both inside the repository', async () => {
    const { port, calls } = fakeGit([{}, {}]);
    const outcome = await runInstall(port, '/repo', PLAN);
    expect(outcome).toEqual({ ok: true, detail: '.paw/modules/paw-agile at main' });
    expect(calls).toEqual([
      ['git', 'clone', '/src/paw-agile', '.paw/modules/paw-agile'],
      ['git', '-C', '.paw/modules/paw-agile', 'checkout', '--detach', 'main'],
    ]);
  });

  it('reports git’s own message when the clone fails, and does not check out', async () => {
    const { port, calls } = fakeGit([{ code: 128, stderr: 'repository not found' }]);
    const outcome = await runInstall(port, '/repo', PLAN);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toContain('repository not found');
    expect(calls).toHaveLength(1);
  });

  it('reports a ref that does not exist, saying the clone did land', async () => {
    const { port } = fakeGit([{}, { code: 1, stderr: 'pathspec did not match' }]);
    const outcome = await runInstall(port, '/repo', PLAN);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toContain('cloned, but ref "main"');
    expect(outcome.ok === false && outcome.reason).toContain('pathspec did not match');
  });

  it('says so when git fails silently', async () => {
    const { port } = fakeGit([{ code: 1 }]);
    const outcome = await runInstall(port, '/repo', PLAN);
    expect(outcome.ok === false && outcome.reason).toContain('git gave no reason');
  });

  it('carries stdout when git wrote there instead', async () => {
    const { port } = fakeGit([{ code: 1, stdout: 'fatal: destination exists' }]);
    const outcome = await runInstall(port, '/repo', PLAN);
    expect(outcome.ok === false && outcome.reason).toContain('destination exists');
  });
});
