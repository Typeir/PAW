/**
 * PAW Init Scaffold Tests
 *
 * @fileoverview Cover `planInit`: host-agnostic config, delegating git hook,
 * and `.paw/.gitignore`, with exec flags. Pin bytes attach writes.
 *
 * @module @paw/core/test/domain/initScaffold
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import { ignorePathFor, pawIgnoreText, planInit } from '../../src/domain/initScaffold.js';

describe('pawIgnoreText', () => {
  it('writes the header and every entry into a new file', () => {
    expect(pawIgnoreText('')).toBe(
      '# Written by `paw init`: PAW runtime state and credential files.\n' +
        'daemon.token\ndaemon.lock\ndaemon.log\npaw.sqlite\nconsole.endpoint.json\n*.env\n.env*\n',
    );
  });

  it('keeps an existing file and appends only its missing entries', () => {
    expect(pawIgnoreText('mine\n*.env\n')).toBe(
      'mine\n*.env\ndaemon.token\ndaemon.lock\ndaemon.log\npaw.sqlite\nconsole.endpoint.json\n.env*\n',
    );
  });
});

describe('planInit', () => {
  const plan = planInit('/work/repo');
  const ignore = (p: typeof plan) => p.writes.find((w) => w.path === ignorePathFor('/work/repo'));

  it('writes a host-agnostic .paw/config.json (not executable)', () => {
    const config = plan.writes.find((w) => w.path.endsWith('config.json'));
    expect(config?.executable).toBe(false);
    expect(JSON.parse(config?.content ?? '{}')).toMatchObject({
      root: '.paw',
      connector: 'copilot-hooks',
    });
  });

  it('writes a pre-commit hook that runs the gates on staged files (executable)', () => {
    const hook = plan.writes.find((w) => w.path.includes('pre-commit'));
    expect(hook?.executable).toBe(true);
    expect(hook?.content).toContain('exec paw gates --staged\n');
  });

  it('writes .paw/.gitignore covering runtime state and credential files (not executable)', () => {
    expect(ignore(plan)).toEqual({
      path: '/work/repo/.paw/.gitignore',
      executable: false,
      content:
        '# Written by `paw init`: PAW runtime state and credential files.\n' +
        'daemon.token\ndaemon.lock\ndaemon.log\npaw.sqlite\nconsole.endpoint.json\n*.env\n.env*\n',
    });
  });

  it('appends only missing entries to an existing .paw/.gitignore, keeping its lines', () => {
    const merged = planInit('/work/repo', null, 'create', 'mine\ndaemon.token\n');
    expect(ignore(merged)?.content).toBe(
      'mine\ndaemon.token\ndaemon.lock\ndaemon.log\npaw.sqlite\nconsole.endpoint.json\n*.env\n.env*\n',
    );
  });

  it('vendors no framework code — only config, the hook, and the ignore file', () => {
    expect(plan.writes).toHaveLength(3);
    expect(plan.root).toBe('/work/repo');
  });
});
