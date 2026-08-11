/**
 * PAW Node Filesystem Adapter Tests
 *
 * @fileoverview Run adapter against a temp dir. Missing file read back empty. Write create parents. Per CONSTRAINTS.md Constraint 3, read that fail for anything but absence propagate.
 *
 * @module @paw/adapters/test/file/nodeFs
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNodeFs } from '../../src/file/nodeFs.js';

let dir = '';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'paw-nodefs-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('createNodeFs', () => {
  it('reads a file it wrote', async () => {
    const fs = createNodeFs();
    const path = join(dir, 'plain.txt');
    await fs.writeText(path, 'hello');
    expect(await fs.readText(path)).toBe('hello');
  });

  it('reads a missing file as empty rather than rejecting', async () => {
    expect(await createNodeFs().readText(join(dir, 'nope.txt'))).toBe('');
  });

  it('propagates a read that failed for a reason other than absence', async () => {
    const fs = createNodeFs();
    const asDirectory = join(dir, 'a-directory');
    await fs.ensureDir(asDirectory);
    await expect(fs.readText(asDirectory)).rejects.toThrow();
  });

  it('overwrites on a second write', async () => {
    const fs = createNodeFs();
    const path = join(dir, 'twice.txt');
    await fs.writeText(path, 'first');
    await fs.writeText(path, 'second');
    expect(await readFile(path, 'utf8')).toBe('second');
  });

  it('appends, creating the file when it is absent', async () => {
    const fs = createNodeFs();
    const path = join(dir, 'appended.txt');
    await fs.appendText(path, 'one');
    await fs.appendText(path, '-two');
    expect(await readFile(path, 'utf8')).toBe('one-two');
  });

  it('creates a directory and its parents, and is idempotent', async () => {
    const fs = createNodeFs();
    const nested = join(dir, 'a', 'b', 'c');
    await fs.ensureDir(nested);
    await fs.ensureDir(nested);
    expect((await stat(nested)).isDirectory()).toBe(true);
  });

  it('chmods when the platform is POSIX', async () => {
    const fs = createNodeFs('linux');
    const path = join(dir, 'hook.sh');
    await writeFile(path, '#!/bin/sh\n', 'utf8');

    await expect(fs.setExecutable(path)).resolves.toBeUndefined();

    if (process.platform !== 'win32') {
      expect((await stat(path)).mode & 0o111).toBeGreaterThan(0);
    }
  });

  it('skips the executable bit on Windows, which has none to set', async () => {
    const fs = createNodeFs('win32');
    const path = join(dir, 'nothing-to-chmod.txt');
    await writeFile(path, 'x', 'utf8');
    await expect(fs.setExecutable(path)).resolves.toBeUndefined();
  });
});
