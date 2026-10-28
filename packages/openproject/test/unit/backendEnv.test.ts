/**
 * @fileoverview Cover {@link parseBackendEnv}: required keys, comments, quotes, CRLF, the trailing
 * slash on the base URL, and the refusal naming every missing key.
 *
 * @module @paw/openproject/test/unit/backendEnv
 */

import { describe, expect, it } from 'vitest';
import { ENV_FILE, parseBackendEnv } from '../../src/domain/backendEnv.js';

describe('parseBackendEnv', () => {
  it('reads BASE_URL, KEY, and PROJECT, dropping the trailing slash, quotes, and comments', () => {
    const text = '# local instance\r\nBASE_URL="http://localhost:18080/"\r\nKEY = \'abc\'\r\nPROJECT=paw-spike\r\n';
    expect(parseBackendEnv(text)).toEqual({
      ok: true,
      config: { baseUrl: 'http://localhost:18080', key: 'abc', project: 'paw-spike' },
    });
  });

  it('refuses naming every missing key and the file', () => {
    expect(parseBackendEnv('KEY=abc\nnot a line\n')).toEqual({
      ok: false,
      reason: `${ENV_FILE} needs BASE_URL, PROJECT`,
    });
  });

  it('names the env file under .paw', () => {
    expect(ENV_FILE).toBe('.paw/openproject.backend.env');
  });
});
