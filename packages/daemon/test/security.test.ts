/**
 * Security Policy Tests
 *
 * @fileoverview The three gates, tested as an attacker would probe them: a token
 * that must not leak its length or its prefix, an origin list that must refuse
 * `null` and everything it was not told about, a host list that must refuse a
 * rebinding name, and a CORS posture that must emit nothing at all for a
 * stranger. Also the two headers that are deliberately *absent* — credentials
 * and HSTS — because a later "helpful" addition of either is a regression this
 * suite is here to catch.
 *
 * @module @paw/daemon/test/security
 */

import { LIVE_SUBPROTOCOL, MAX_PREAUTH_SESSIONS, MAX_SESSIONS } from '@paw/core';
import { describe, expect, it } from 'vitest';
import {
  LOOPBACK_HOSTS,
  TOKEN_BYTES,
  allowedOrigins,
  bearerFrom,
  corsHeadersFor,
  cspFor,
  decideUpgrade,
  hostAllowed,
  inlineScriptHashes,
  normaliseOrigin,
  originAllowed,
  securityHeaders,
  selfOrigins,
  verifyToken,
} from '../src/security.js';

const TOKEN = 'kA7Zr3pQ9x_TokenValue-1234567890abcdefghijklmnop';

describe('verifyToken', () => {
  it('accepts the real token', () => {
    expect(verifyToken(TOKEN, TOKEN)).toBe(true);
  });

  it('refuses a wrong token of the same length', () => {
    const wrong = `${TOKEN.slice(0, -1)}X`;
    expect(wrong).toHaveLength(TOKEN.length);
    expect(verifyToken(TOKEN, wrong)).toBe(false);
  });

  it('refuses a correct prefix, a longer guess, and an empty one', () => {
    expect(verifyToken(TOKEN, TOKEN.slice(0, 10))).toBe(false);
    expect(verifyToken(TOKEN, `${TOKEN}extra`)).toBe(false);
    expect(verifyToken(TOKEN, '')).toBe(false);
  });

  it('refuses a missing credential rather than throwing', () => {
    expect(verifyToken(TOKEN, null)).toBe(false);
    expect(verifyToken(TOKEN, undefined)).toBe(false);
  });

  it('mints 256 bits of token', () => {
    expect(TOKEN_BYTES).toBe(32);
  });
});

describe('bearerFrom', () => {
  it('reads a bearer credential, however the scheme is cased', () => {
    expect(bearerFrom(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(bearerFrom(`bearer ${TOKEN}`)).toBe(TOKEN);
    expect(bearerFrom(`BEARER   ${TOKEN}`)).toBe(TOKEN);
    expect(bearerFrom(`  Bearer ${TOKEN}  `)).toBe(TOKEN);
  });

  it('reads nothing from a missing or foreign credential', () => {
    expect(bearerFrom(undefined)).toBeNull();
    expect(bearerFrom('')).toBeNull();
    expect(bearerFrom('Basic dXNlcjpwYXNz')).toBeNull();
    expect(bearerFrom('Bearer')).toBeNull();
    expect(bearerFrom('Bearer a b')).toBeNull();
  });
});

describe('selfOrigins / allowedOrigins / normaliseOrigin', () => {
  it('trusts all three spellings of its own loopback origin', () => {
    expect(selfOrigins(8971)).toEqual([
      'https://127.0.0.1:8971',
      'https://localhost:8971',
      'https://[::1]:8971',
    ]);
  });

  it('accepts an https origin and a loopback http development server', () => {
    expect(normaliseOrigin('https://console.example')).toBe('https://console.example');
    expect(normaliseOrigin('http://localhost:5173')).toBe('http://localhost:5173');
    expect(normaliseOrigin('http://127.0.0.1:5173/some/path')).toBe('http://127.0.0.1:5173');
  });

  it('refuses a wildcard, a foreign scheme, junk, and plaintext off the machine', () => {
    expect(normaliseOrigin('*')).toBeNull();
    expect(normaliseOrigin('null')).toBeNull();
    expect(normaliseOrigin('')).toBeNull();
    expect(normaliseOrigin('file:///tmp')).toBeNull();
    expect(normaliseOrigin('ws://localhost:5173')).toBeNull();
    expect(normaliseOrigin('http://evil.example')).toBeNull();
  });

  it('folds the operator’s origins in beside its own, dropping refusals', () => {
    const allowed = allowedOrigins(8971, ['http://localhost:5173', 'http://evil.example', '*']);
    expect(allowed).toContain('https://127.0.0.1:8971');
    expect(allowed).toContain('http://localhost:5173');
    expect(allowed).not.toContain('http://evil.example');
    expect(new Set(allowed).size).toBe(allowed.length);
  });

  it('does not duplicate an origin it already serves itself on', () => {
    expect(allowedOrigins(8971, ['https://127.0.0.1:8971'])).toHaveLength(3);
  });
});

describe('originAllowed', () => {
  const allowed = allowedOrigins(8971);

  it('admits its own origins', () => {
    expect(originAllowed('https://127.0.0.1:8971', allowed)).toBe(true);
    expect(originAllowed('https://localhost:8971', allowed)).toBe(true);
  });

  it('refuses a stranger, a look-alike port, and an unattributable page', () => {
    expect(originAllowed('https://evil.example', allowed)).toBe(false);
    expect(originAllowed('https://127.0.0.1:9999', allowed)).toBe(false);
    expect(originAllowed('http://127.0.0.1:8971', allowed)).toBe(false);
    expect(originAllowed('null', allowed)).toBe(false);
  });

  it('lets a non-browser through to face the token instead', () => {
    expect(originAllowed(undefined, allowed)).toBe(true);
  });
});

describe('hostAllowed', () => {
  it('admits every loopback spelling on the bound port', () => {
    expect(hostAllowed('127.0.0.1:8971', 8971)).toBe(true);
    expect(hostAllowed('localhost:8971', 8971)).toBe(true);
    expect(hostAllowed('[::1]:8971', 8971)).toBe(true);
    expect(hostAllowed('  localhost:8971  ', 8971)).toBe(true);
  });

  it('refuses a rebinding name even on the right port', () => {
    expect(hostAllowed('evil.example:8971', 8971)).toBe(false);
    expect(hostAllowed('paw.localhost:8971', 8971)).toBe(false);
  });

  it('refuses the right name on the wrong port', () => {
    expect(hostAllowed('127.0.0.1:9999', 8971)).toBe(false);
  });

  it('refuses a missing or malformed host', () => {
    expect(hostAllowed(undefined, 8971)).toBe(false);
    expect(hostAllowed('', 8971)).toBe(false);
    expect(hostAllowed('127.0.0.1:not-a-port', 8971)).toBe(false);
  });

  it('accepts a port-less host only when the daemon is on 443', () => {
    expect(hostAllowed('localhost', 443)).toBe(true);
    expect(hostAllowed('localhost', 8971)).toBe(false);
  });

  it('names the loopback spellings once, for every gate to share', () => {
    expect(LOOPBACK_HOSTS).toEqual(['127.0.0.1', 'localhost', '[::1]', '::1']);
  });
});

describe('decideUpgrade', () => {
  const base = {
    host: '127.0.0.1:8971',
    origin: 'https://127.0.0.1:8971',
    protocols: [LIVE_SUBPROTOCOL],
    port: 8971,
    origins: allowedOrigins(8971),
    liveSessions: 0,
    preAuthSessions: 0,
  };

  it('lets the console’s own page through', () => {
    expect(decideUpgrade(base)).toBeNull();
  });

  it('lets a non-browser client through to face the token instead', () => {
    // No Origin means no browser, so there is no origin to judge — the first
    // frame still has to carry the credential.
    expect(decideUpgrade({ ...base, origin: undefined })).toBeNull();
  });

  it('refuses a rebinding Host before any WebSocket state exists', () => {
    expect(decideUpgrade({ ...base, host: 'evil.example' })).toEqual({
      status: 400,
      message: 'bad host',
    });
    expect(decideUpgrade({ ...base, host: undefined })?.status).toBe(400);
  });

  it('refuses a stranger’s Origin — the handshake is exempt from CORS, so this is the only gate', () => {
    expect(decideUpgrade({ ...base, origin: 'https://evil.example' })).toEqual({
      status: 403,
      message: 'origin not allowed',
    });
    expect(decideUpgrade({ ...base, origin: 'null' })?.status).toBe(403);
  });

  it('refuses a client that did not offer the versioned subprotocol', () => {
    expect(decideUpgrade({ ...base, protocols: [] })?.status).toBe(400);
    expect(decideUpgrade({ ...base, protocols: ['chat'] })?.status).toBe(400);
    expect(decideUpgrade({ ...base, protocols: ['paw.live.v2'] })?.status).toBe(400);
    expect(decideUpgrade({ ...base, protocols: ['chat', LIVE_SUBPROTOCOL] })).toBeNull();
  });

  it('refuses once it is full, counting authenticated and unauthenticated separately', () => {
    expect(decideUpgrade({ ...base, liveSessions: MAX_SESSIONS })).toEqual({
      status: 429,
      message: 'too many sessions',
    });
    expect(decideUpgrade({ ...base, preAuthSessions: MAX_PREAUTH_SESSIONS })?.status).toBe(429);
    expect(decideUpgrade({ ...base, liveSessions: MAX_SESSIONS - 1 })).toBeNull();
    expect(decideUpgrade({ ...base, preAuthSessions: MAX_PREAUTH_SESSIONS - 1 })).toBeNull();
  });

  it('never locks the operator out over someone else’s failed guesses', () => {
    // A global cooldown here would be a denial of service any local process can
    // trigger against the operator's own console — the daemon cannot tell one
    // loopback peer from another, so it must not try to punish by peer.
    expect(decideUpgrade(base)).toBeNull();
    expect(Object.keys(base)).not.toContain('cooldownActive');
  });

  it('judges the request before the daemon’s own capacity', () => {
    // A rebinding page must be told 400 whether or not the daemon happens to be
    // busy: the answer must not depend on load, or it becomes a probe.
    const busy = { ...base, liveSessions: MAX_SESSIONS };
    expect(decideUpgrade({ ...busy, host: 'evil.example' })?.status).toBe(400);
    expect(decideUpgrade({ ...busy, origin: 'https://evil.example' })?.status).toBe(403);
  });

  it('never says anything about the token in a refusal', () => {
    const refusals = [
      decideUpgrade({ ...base, host: 'evil.example' }),
      decideUpgrade({ ...base, origin: 'null' }),
      decideUpgrade({ ...base, protocols: [] }),
      decideUpgrade({ ...base, liveSessions: MAX_SESSIONS }),
    ];
    for (const refusal of refusals) {
      expect(refusal?.message.toLowerCase()).not.toContain('token');
      expect(refusal?.message.toLowerCase()).not.toContain('credential');
    }
  });
});

describe('corsHeadersFor', () => {
  const allowed = allowedOrigins(8971, ['http://localhost:5173']);

  it('answers a listed origin with exactly that origin, never a wildcard', () => {
    const headers = corsHeadersFor('http://localhost:5173', allowed);
    expect(headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(headers['access-control-allow-origin']).not.toBe('*');
    expect(headers['access-control-allow-methods']).toBe('GET, OPTIONS');
    expect(headers['access-control-allow-headers']).toBe('authorization');
    expect(headers.vary).toBe('Origin');
  });

  it('grants nothing to a stranger, and nothing when there is no origin', () => {
    expect(corsHeadersFor('https://evil.example', allowed)).toEqual({ vary: 'Origin' });
    expect(corsHeadersFor(undefined, allowed)).toEqual({ vary: 'Origin' });
  });

  it('never allows credentials — there is no cookie to ride in on', () => {
    for (const origin of [undefined, 'https://evil.example', 'http://localhost:5173']) {
      expect(corsHeadersFor(origin, allowed)).not.toHaveProperty(
        'access-control-allow-credentials',
      );
    }
  });
});

describe('securityHeaders', () => {
  it('sends the baseline every response carries', () => {
    expect(securityHeaders()).toEqual({
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-resource-policy': 'same-origin',
    });
  });

  it('deliberately omits HSTS, which would hijack every localhost port', () => {
    expect(securityHeaders()).not.toHaveProperty('strict-transport-security');
  });
});

describe('cspFor', () => {
  const csp = cspFor(8971);

  it('denies by default and grants the console only its own socket', () => {
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('connect-src https://127.0.0.1:8971');
    expect(csp).toContain('wss://127.0.0.1:8971');
    expect(csp).toContain('wss://localhost:8971');
    expect(csp).toContain('wss://[::1]:8971');
  });

  it('permits no plaintext socket, no frame, no form, no base', () => {
    expect(csp).not.toContain('ws://');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it('does not grant a bare self, which would not cover the socket scheme', () => {
    expect(csp).not.toContain("connect-src 'self'");
  });
});

describe('inlineScriptHashes', () => {
  it('names each inline script by digest', () => {
    const hashes = inlineScriptHashes('<html><script>alert(1)</script></html>');
    expect(hashes).toHaveLength(1);
    expect(hashes[0]).toMatch(/^'sha256-[A-Za-z0-9+/]+=*'$/);
  });

  it('changes completely for a single changed byte, which is the point', () => {
    const [before] = inlineScriptHashes('<script>alert(1)</script>');
    const [after] = inlineScriptHashes('<script>alert(2)</script>');
    expect(before).not.toBe(after);
  });

  it('covers the body exactly as the browser sees it, trimming nothing', () => {
    const [padded] = inlineScriptHashes('<script>  alert(1)  </script>');
    const [tight] = inlineScriptHashes('<script>alert(1)</script>');
    expect(padded).not.toBe(tight);
  });

  it('reads every inline script, attributes and all, and deduplicates', () => {
    const hashes = inlineScriptHashes(
      '<script type="module">a()</script><script defer>b()</script><script>a()</script>',
    );
    expect(hashes).toHaveLength(2);
  });

  it('skips a script with a src, which has no inline body to hash', () => {
    expect(inlineScriptHashes('<script src="/bundle.js"></script>')).toEqual([]);
    expect(inlineScriptHashes('<script src="/b.js" defer></script>')).toEqual([]);
  });

  it('skips an empty script and a page with none', () => {
    expect(inlineScriptHashes('<script></script>')).toEqual([]);
    expect(inlineScriptHashes('<html><body>nothing</body></html>')).toEqual([]);
  });

  it('is what turns the CSP from a general permission into a named one', () => {
    const page = '<html><script>boot()</script></html>';
    const named = cspFor(8971, inlineScriptHashes(page));
    expect(named).toContain("script-src 'sha256-");
    expect(named).not.toContain("script-src 'unsafe-inline'");

    // With nothing to hash there is nothing to name, and the fallback is the
    // honest one — a browser ignores 'unsafe-inline' the moment a hash appears,
    // so emitting both would be a policy that silently means only the hashes.
    expect(cspFor(8971, [])).toContain("script-src 'unsafe-inline'");
  });
});
