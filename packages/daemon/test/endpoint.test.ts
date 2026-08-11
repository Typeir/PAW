/**
 * @fileoverview Test daemon endpoint addressing. Pin stable
 * case/slash-insensitive project id. Pin win32 pipe form. Pin POSIX socket
 * form (with and without `$XDG_RUNTIME_DIR`). Pin token/lock paths. Cover
 * `endpoint.ts` 100% on either host.
 *
 * @module @paw/daemon/test/endpoint
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  lockPath,
  projectId,
  socketPath,
  tokenPath,
  type EndpointEnv,
} from '../src/infrastructure/endpoint.js';

const ROOT = 'C:/Users/dtira/Desktop/Ikuisuus';

describe('projectId', () => {
  it('is a 12-char hex id', () => {
    expect(projectId(ROOT)).toMatch(/^[0-9a-f]{12}$/);
  });

  it('normalises case and backslashes, so one checkout is one id', () => {
    expect(projectId('C:\\Users\\dtira\\Desktop\\Ikuisuus')).toBe(projectId(ROOT.toLowerCase()));
  });

  it('separates different roots', () => {
    expect(projectId(ROOT)).not.toBe(projectId(`${ROOT}-other`));
  });
});

describe('socketPath', () => {
  const id = projectId(ROOT);

  it('is a named pipe on win32', () => {
    const env: EndpointEnv = { platform: 'win32', xdgRuntimeDir: undefined, tmpdir: '/tmp' };
    expect(socketPath(ROOT, env)).toBe(`\\\\.\\pipe\\paw-${id}`);
  });

  it('prefers XDG_RUNTIME_DIR on POSIX', () => {
    const env: EndpointEnv = { platform: 'linux', xdgRuntimeDir: '/run/user/1000', tmpdir: '/tmp' };
    expect(socketPath(ROOT, env)).toBe(join('/run/user/1000', `paw-${id}.sock`));
  });

  it('falls back to tmpdir when XDG is unset', () => {
    const env: EndpointEnv = { platform: 'darwin', xdgRuntimeDir: undefined, tmpdir: '/var/tmp' };
    expect(socketPath(ROOT, env)).toBe(join('/var/tmp', `paw-${id}.sock`));
  });
});

describe('token + lock paths', () => {
  it('places the token and lock under .paw', () => {
    expect(tokenPath('/repo/.paw')).toBe(join('/repo/.paw', 'daemon.token'));
    expect(lockPath('/repo/.paw')).toBe(join('/repo/.paw', 'daemon.lock'));
  });
});
