/**
 * PAW Daemon Router Tests
 *
 * @fileoverview Every route arm and — more importantly — every refusal. The
 * gates are tested from the attacker's side: a rebinding `Host`, a page's
 * `Origin`, a missing or wrong bearer token, a preflight from a stranger. The
 * page stays reachable without a credential because it carries no data; nothing
 * under `/api/` does. The last group is the one that matters most in review: the
 * token must never appear in a response, and a refusal must never leak whether
 * the resource behind it exists.
 *
 * @module @paw/daemon/test/router
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { PawSnapshot, TreeNode } from '@paw/core';
import { UnknownPlanError } from '../src/domain/plans.js';
import { route, type HttpRequest, type RouterDeps } from '../src/domain/router.js';
import { allowedOrigins, inlineScriptHashes } from '../src/infrastructure/security.js';

const PORT = 8971;
const TOKEN = 'router-token-value-0123456789abcdef';
const ORIGIN = `https://127.0.0.1:${PORT}`;

const snapshot = { host: { pid: 7 }, processes: [] } as unknown as PawSnapshot;

const tree: TreeNode[] = [
  {
    name: 'src',
    path: 'src',
    isFile: false,
    children: [{ name: 'main.ts', path: 'src/main.ts', isFile: true, children: [] }],
  },
];

const deps: RouterDeps = {
  page: '<html>pawd<script>console.log(1)</script></html>',
  snapshot: async () => snapshot,
  tree: () => tree,
  token: TOKEN,
  port: PORT,
  scriptHashes: inlineScriptHashes('<html>pawd<script>console.log(1)</script></html>'),
  origins: allowedOrigins(PORT, ['http://localhost:5173']),
};

/**
 * A request as the console's own page would send it.
 *
 * @param {string} path - The path.
 * @param {Partial<HttpRequest>} [over] - Overrides.
 * @returns {HttpRequest} The request.
 */
const req = (path: string, over: Partial<HttpRequest> = {}): HttpRequest => ({
  method: 'GET',
  path,
  ...over,
  headers: {
    host: `127.0.0.1:${PORT}`,
    origin: ORIGIN,
    authorization: `Bearer ${TOKEN}`,
    ...over.headers,
  },
});

describe('the page', () => {
  it('is served at / and /index.html with a per-boot CSP naming its own socket', async () => {
    for (const path of ['/', '/index.html']) {
      const res = await route(req(path), deps);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.headers['content-security-policy']).toContain(`wss://127.0.0.1:${PORT}`);
      expect(res.body).toBe(deps.page);
      // The grant names the bundle by digest rather than permitting inline
      // scripts in general, so a script injected through a rendering bug is
      // refused by the browser rather than run.
      expect(res.headers['content-security-policy']).toContain("script-src 'sha256-");
      expect(res.headers['content-security-policy']).not.toContain("script-src 'unsafe-inline'");
    }
  });

  it('needs no credential — it is the bundle, and carries no data', async () => {
    const res = await route(req('/', { headers: { authorization: undefined } }), deps);
    expect(res.status).toBe(200);
  });

  it('carries the baseline security headers, and never HSTS', async () => {
    const res = await route(req('/'), deps);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(res.headers).not.toHaveProperty('strict-transport-security');
  });
});

describe('the host gate', () => {
  it('refuses a rebinding name before it refuses anything else', async () => {
    const res = await route(req('/', { headers: { host: 'evil.example:8971' } }), deps);
    expect(res.status).toBe(400);
    expect(res.body).toBe('bad host');
  });

  it('refuses a request with no host at all', async () => {
    const res = await route(req('/api/state', { headers: { host: undefined } }), deps);
    expect(res.status).toBe(400);
  });

  it('refuses a request carrying no headers whatsoever', async () => {
    const res = await route({ method: 'GET', path: '/api/state' }, deps);
    expect(res.status).toBe(400);
  });

  it('admits every loopback spelling of its own authority', async () => {
    for (const host of [`localhost:${PORT}`, `[::1]:${PORT}`, `127.0.0.1:${PORT}`]) {
      expect((await route(req('/', { headers: { host } }), deps)).status).toBe(200);
    }
  });
});

describe('the origin gate', () => {
  it('refuses an API call from a page it was never told about', async () => {
    const res = await route(
      req('/api/state', { headers: { origin: 'https://evil.example' } }),
      deps,
    );
    expect(res.status).toBe(403);
    expect(res.headers).not.toHaveProperty('access-control-allow-origin');
  });

  it('refuses an unattributable origin outright', async () => {
    expect((await route(req('/api/state', { headers: { origin: 'null' } }), deps)).status).toBe(
      403,
    );
  });

  it('admits the development server the operator allowed', async () => {
    const res = await route(
      req('/api/state', { headers: { origin: 'http://localhost:5173' } }),
      deps,
    );
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('admits a caller with no origin, which then faces the token', async () => {
    const res = await route(req('/api/state', { headers: { origin: undefined } }), deps);
    expect(res.status).toBe(200);
    expect(res.headers).not.toHaveProperty('access-control-allow-origin');
  });
});

describe('the token gate', () => {
  it('refuses an API call with no credential, and says how to authenticate', async () => {
    const res = await route(req('/api/state', { headers: { authorization: undefined } }), deps);
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer realm="pawd"');
    expect(res.body).toBe('unauthorized');
  });

  it('refuses a wrong token and a foreign scheme', async () => {
    for (const authorization of [`Bearer ${TOKEN}x`, `Basic ${TOKEN}`, 'Bearer']) {
      expect((await route(req('/api/state', { headers: { authorization } }), deps)).status).toBe(
        401,
      );
    }
  });

  it('gates the tree exactly as it gates the state', async () => {
    const res = await route(req('/api/tree', { headers: { authorization: undefined } }), deps);
    expect(res.status).toBe(401);
  });

  it('refuses an unknown /api/ path with 401 before admitting it does not exist', async () => {
    const res = await route(req('/api/secrets', { headers: { authorization: undefined } }), deps);
    expect(res.status).toBe(401);
  });

  it('answers 404 for an unknown /api/ path once authenticated', async () => {
    expect((await route(req('/api/secrets'), deps)).status).toBe(404);
  });
});

describe('preflight', () => {
  it('answers an allowed origin with the grant and no body', async () => {
    const res = await route(
      req('/api/state', { method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } }),
      deps,
    );
    expect(res.status).toBe(204);
    expect(res.body).toBe('');
    expect(res.headers['access-control-allow-methods']).toBe('GET, OPTIONS');
    expect(res.headers['access-control-allow-headers']).toBe('authorization');
    expect(res.headers).not.toHaveProperty('access-control-allow-credentials');
  });

  it('refuses a stranger’s preflight, and any preflight off the API', async () => {
    expect(
      (
        await route(
          req('/api/state', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }),
          deps,
        )
      ).status,
    ).toBe(403);
    expect((await route(req('/', { method: 'OPTIONS' }), deps)).status).toBe(403);
  });
});

describe('the routes themselves', () => {
  it('serves the live snapshot, calling the provider per request', async () => {
    const provider = vi.fn(async () => snapshot);
    const res = await route(req('/api/state'), { ...deps, snapshot: provider });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(res.body)).toMatchObject({ host: { pid: 7 } });
    expect(provider).toHaveBeenCalledOnce();
  });

  it('passes the selected plan through, and nothing when none was asked for', async () => {
    const provider = vi.fn(async () => snapshot);
    await route(req('/api/state', { query: new URLSearchParams('plan=a.swarm.mjs') }), {
      ...deps,
      snapshot: provider,
    });
    expect(provider).toHaveBeenCalledWith('a.swarm.mjs');

    await route(req('/api/state'), { ...deps, snapshot: provider });
    expect(provider).toHaveBeenLastCalledWith(undefined);
  });

  it('answers 404 when the selection names a plan the repository does not hold', async () => {
    const res = await route(req('/api/state'), {
      ...deps,
      snapshot: async () => {
        throw new UnknownPlanError('../evil.swarm.mjs');
      },
    });
    expect(res.status).toBe(404);
    expect(res.body).toContain('no such plan in this repository');
  });

  it('lets any other snapshot failure crash loudly rather than reading as a 404', async () => {
    await expect(
      route(req('/api/state'), {
        ...deps,
        snapshot: async () => {
          throw new Error('disk on fire');
        },
      }),
    ).rejects.toThrow('disk on fire');
  });

  it('serves the whole tree, and narrows it, and refuses a root it does not hold', async () => {
    for (const query of [undefined, new URLSearchParams('root='), new URLSearchParams('root=.')]) {
      const res = await route(req('/api/tree', { query }), deps);
      expect(JSON.parse(res.body)).toEqual(tree);
    }
    const narrowed = await route(
      req('/api/tree', { query: new URLSearchParams('root=src') }),
      deps,
    );
    expect(JSON.parse(narrowed.body)).toEqual([
      { name: 'main.ts', path: 'src/main.ts', isFile: true, children: [] },
    ]);
    const missing = await route(
      req('/api/tree', { query: new URLSearchParams('root=../../etc') }),
      deps,
    );
    expect(missing.status).toBe(404);
  });

  it('rejects a write, wherever it is aimed', async () => {
    expect((await route(req('/', { method: 'POST' }), deps)).status).toBe(405);
    expect((await route(req('/api/state', { method: 'DELETE' }), deps)).status).toBe(405);
  });

  it('answers 404 for an unknown path outside the API', async () => {
    const res = await route(req('/nope'), deps);
    expect(res.status).toBe(404);
    expect(res.body).toBe('not found');
  });
});

describe('what must never leak', () => {
  it('never puts the token in any response, on any path', async () => {
    const paths: HttpRequest[] = [
      req('/'),
      req('/api/state'),
      req('/api/tree'),
      req('/nope'),
      req('/api/state', { headers: { authorization: 'Bearer wrong' } }),
      req('/api/state', { headers: { origin: 'https://evil.example' } }),
      req('/', { headers: { host: 'evil.example:8971' } }),
      req('/', { method: 'POST' }),
    ];
    for (const request of paths) {
      const res = await route(request, deps);
      expect(JSON.stringify(res)).not.toContain(TOKEN);
    }
  });

  it('says the same thing whether an API path exists or not, until authenticated', async () => {
    const real = await route(req('/api/state', { headers: { authorization: undefined } }), deps);
    const fake = await route(req('/api/nope', { headers: { authorization: undefined } }), deps);
    expect(real.status).toBe(fake.status);
    expect(real.body).toBe(fake.body);
  });
});
