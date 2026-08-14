/**
 * PAW daemon router test.
 *
 * @fileoverview Test every route branch. Test every refusal most. Test gate from
 * attacker side: rebind `Host`, page `Origin`, miss or wrong bearer token,
 * stranger preflight. Page stay reachable without credential, carry no data;
 * nothing under `/api/` carry data. Last group matter most in review: token never
 * appear in response, refusal never leak whether resource behind it exist.
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
import type { ControlRequest, ControlResult } from '../src/domain/control.js';
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
  config: () => ({ models: ['fast', 'slow'], roles: { 'edit.apply': 'fast' } }),
  recent: async () => ['/repo/a', '/repo/b'],
  token: TOKEN,
  port: PORT,
  scriptHashes: inlineScriptHashes('<html>pawd<script>console.log(1)</script></html>'),
  origins: allowedOrigins(PORT, ['http://localhost:5173']),
};

/**
 * Request, same way console own page send it.
 *
 * @param {string} path - The path.
 * @param {Partial<HttpRequest>} [over] - Override.
 * @returns {HttpRequest} The request, built.
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
      // Grant name bundle by digest, no allow inline script general. Script
      // injected via rendering bug — browser refuse, no run it.
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
    expect(res.headers['access-control-allow-methods']).toBe('GET, POST, PUT, DELETE, OPTIONS');
    expect(res.headers['access-control-allow-headers']).toBe('authorization, content-type');
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

  it('serves the declared models and role bindings for the config editor', async () => {
    const res = await route(req('/api/config'), deps);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ models: ['fast', 'slow'], roles: { 'edit.apply': 'fast' } });
  });

  it('answers 404 for /api/config when the daemon exposes none', async () => {
    const { config: _omit, ...noConfig } = deps;
    expect((await route(req('/api/config'), noConfig)).status).toBe(404);
  });

  it('serves the recently-grabbed routes for the scope picker', async () => {
    const res = await route(req('/api/recent'), deps);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual(['/repo/a', '/repo/b']);
  });

  it('serves an empty list for /api/recent when the daemon keeps no history', async () => {
    const { recent: _omit, ...noRecent } = deps;
    const res = await route(req('/api/recent'), noRecent);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  it('forgets a recent route on an authorized DELETE, returning the new list', async () => {
    const forgotten: string[] = [];
    const res = await route(
      req('/api/recent', { method: 'DELETE', query: new URLSearchParams('route=/repo/a') }),
      {
        ...deps,
        forgetRecent: async (target) => {
          forgotten.push(target);
          return ['/repo/b'];
        },
      },
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual(['/repo/b']);
    expect(forgotten).toEqual(['/repo/a']);
  });

  it('404s a recent DELETE that names no route or has no store behind it', async () => {
    const withStore = { ...deps, forgetRecent: async () => [] };
    expect((await route(req('/api/recent', { method: 'DELETE' }), withStore)).status).toBe(404);
    expect(
      (
        await route(
          req('/api/recent', { method: 'DELETE', query: new URLSearchParams('route=/x') }),
          deps,
        )
      ).status,
    ).toBe(404);
  });

  it('gates a recent DELETE on origin and token like every API call', async () => {
    const withStore = { ...deps, forgetRecent: async () => [] };
    const q = new URLSearchParams('route=/repo/a');
    expect(
      (
        await route(
          req('/api/recent', {
            method: 'DELETE',
            query: q,
            headers: { origin: 'https://evil.example' },
          }),
          withStore,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await route(
          req('/api/recent', {
            method: 'DELETE',
            query: q,
            headers: { authorization: 'Bearer wrong' },
          }),
          withStore,
        )
      ).status,
    ).toBe(401);
  });

  it('rejects a write, wherever it is aimed', async () => {
    expect((await route(req('/', { method: 'POST' }), deps)).status).toBe(405);
    expect((await route(req('/api/state', { method: 'DELETE' }), deps)).status).toBe(405);
  });

  it('rejects a method that is neither a read, a write, nor a preflight', async () => {
    expect((await route(req('/api/state', { method: 'PATCH' }), deps)).status).toBe(405);
    expect((await route(req('/', { method: 'HEAD' }), deps)).status).toBe(405);
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

const control = {
  handlers: {
    'DELETE /api/violations': async ({ query }: ControlRequest): Promise<ControlResult> => ({
      status: 200,
      body: { cleared: query?.get('file') ? 1 : 9 },
    }),
    'POST /api/echo': async ({ body }: ControlRequest): Promise<ControlResult> => ({
      status: 201,
      body: { echoed: body },
    }),
    'PUT /api/plan': async (): Promise<ControlResult> => ({ status: 200, body: { ok: true } }),
    'POST /api/bad': async (): Promise<ControlResult> => ({ status: 422, body: { error: 'nope' } }),
  },
};

const cdeps: RouterDeps = { ...deps, control };

/**
 * Write request, same way console own page send it: bearer token, daemon origin,
 * JSON body.
 *
 * @param {string} method - The write method.
 * @param {string} path - The path.
 * @param {Partial<HttpRequest>} [over] - Override.
 * @returns {HttpRequest} The request, built.
 */
const write = (method: string, path: string, over: Partial<HttpRequest> = {}): HttpRequest =>
  req(path, {
    method,
    body: '{}',
    ...over,
    headers: { contentType: 'application/json', ...over.headers },
  });

describe('the write pipeline', () => {
  it('refuses every write when the daemon exposes no control port', async () => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      expect((await route(write(method, '/api/violations'), deps)).status).toBe(405);
    }
  });

  it('dispatches a DELETE to its handler, threading the query', async () => {
    const all = await route(write('DELETE', '/api/violations'), cdeps);
    expect(all.status).toBe(200);
    expect(JSON.parse(all.body)).toEqual({ cleared: 9 });
    const one = await route(
      write('DELETE', '/api/violations', { query: new URLSearchParams('file=src/a.ts') }),
      cdeps,
    );
    expect(JSON.parse(one.body)).toEqual({ cleared: 1 });
  });

  it('dispatches a POST, passing the sanitised body and the handler’s status', async () => {
    const res = await route(write('POST', '/api/echo', { body: '{"n":2}' }), cdeps);
    expect(res.status).toBe(201);
    expect(JSON.parse(res.body)).toEqual({ echoed: { n: 2 } });
  });

  it('dispatches a PUT', async () => {
    expect((await route(write('PUT', '/api/plan'), cdeps)).status).toBe(200);
  });

  it('accepts a bodyless write, taking its parameters from the query', async () => {
    const res = await route(
      write('DELETE', '/api/violations', {
        body: undefined,
        query: new URLSearchParams('file=src/a.ts'),
        headers: { contentType: undefined },
      }),
      cdeps,
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ cleared: 1 });
  });

  it('renders a handler’s own refusal status as json, not as a text refusal', async () => {
    const res = await route(write('POST', '/api/bad'), cdeps);
    expect(res.status).toBe(422);
    expect(JSON.parse(res.body)).toEqual({ error: 'nope' });
  });

  it('refuses a write aimed off the API with 404', async () => {
    expect((await route(write('POST', '/nope'), cdeps)).status).toBe(404);
  });

  it('refuses a stranger’s origin with 403, before the token or any dispatch', async () => {
    const res = await route(
      write('DELETE', '/api/violations', { headers: { origin: 'https://evil.example' } }),
      cdeps,
    );
    expect(res.status).toBe(403);
  });

  it('refuses a missing or wrong token with 401', async () => {
    expect(
      (await route(write('DELETE', '/api/violations', { headers: { authorization: undefined } }), cdeps))
        .status,
    ).toBe(401);
    expect(
      (await route(write('DELETE', '/api/violations', { headers: { authorization: 'Bearer wrong' } }), cdeps))
        .status,
    ).toBe(401);
  });

  it('refuses a non-json content type with 415', async () => {
    const res = await route(write('POST', '/api/echo', { headers: { contentType: 'text/plain' } }), cdeps);
    expect(res.status).toBe(415);
  });

  it('refuses malformed json with 400 and a non-object body with 422', async () => {
    expect((await route(write('POST', '/api/echo', { body: '{bad' }), cdeps)).status).toBe(400);
    expect((await route(write('POST', '/api/echo', { body: '[1]' }), cdeps)).status).toBe(422);
  });

  it('answers 404 for an unknown write route once authenticated', async () => {
    expect((await route(write('DELETE', '/api/unknown'), cdeps)).status).toBe(404);
  });

  it('never leaks the token through the write path', async () => {
    const res = await route(write('DELETE', '/api/violations'), cdeps);
    expect(JSON.stringify(res)).not.toContain(TOKEN);
  });
});

describe('the connector roster', () => {
  it('serves the catalogue with enabled state when the daemon supplies one', async () => {
    const roster = [{ id: 'tsc', kind: 'linter', title: 'TypeScript', description: 'x', enabled: true }];
    const res = await route(req('/api/connectors'), { ...deps, connectors: () => roster });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual(roster);
  });

  it('answers 404 with no roster supplied, and 401 without the token', async () => {
    expect((await route(req('/api/connectors'), deps)).status).toBe(404);
    const res = await route(
      req('/api/connectors', { headers: { authorization: 'Bearer wrong' } }),
      { ...deps, connectors: () => [] },
    );
    expect(res.status).toBe(401);
  });
});

describe('the provider roster', () => {
  it('serves the key-free roster when the daemon supplies one', async () => {
    const roster = [{ name: 'deepseek', type: 'openai', baseUrl: 'https://x', keyChars: 5 }];
    const res = await route(req('/api/providers'), { ...deps, providers: () => roster });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual(roster);
  });

  it('answers 404 with no roster supplied, and 401 without the token', async () => {
    expect((await route(req('/api/providers'), deps)).status).toBe(404);
    const res = await route(
      req('/api/providers', { headers: { authorization: 'Bearer wrong' } }),
      { ...deps, providers: () => [] },
    );
    expect(res.status).toBe(401);
  });
});
