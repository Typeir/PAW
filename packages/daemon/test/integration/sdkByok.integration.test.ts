/**
 * Copilot SDK BYOK integration
 *
 * @fileoverview Pin `@github/copilot-sdk` and run it headless in this repo.
 * Guard pin against drift. Raw-fetch shim must no displace SDK path. See
 * `.ignore/research/byoksdk/22-byok-modelport-recovery.md` §8.
 *
 * Version guard always-on, deterministic. Read installed package version.
 * Fail if the pin downgrades or a caret allows it to walk. The pin assertion
 * fails the build below `0.2.2`. The runtime the SDK spawns ships as a
 * sibling `@github/copilot-sdk-<platform>` package; it must carry the pinned
 * version, and the SDK must not depend on the floating `@github/copilot` CLI.
 *
 * Two opt-in live tests behind `PAW_SDK_LIVE=1`. They spawn the ~159 MB
 * Copilot runtime binary. Need no API key, spend no credit. Local stub
 * HTTP server the BYOK provider, reproducible in CI on demand without
 * secret. Test A asserts a session runs with
 * `getAuthStatus().isAuthenticated === false`, sends one outbound request
 * carrying our `Authorization` header, and reaches the stub. Test B dispatches
 * a custom `defineTool` call back into our handler with structured arguments.
 *
 * @module @paw/daemon/test/integration/sdkByok
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startStubProvider, text, toolCall } from '../support/stubProvider.js';

const require = createRequire(import.meta.url);
const PINNED = '1.0.27';
const LIVE = process.env.PAW_SDK_LIVE === '1';

/**
 * Minimal slice of SDK surface the tests exercise. Declare local. Tests bind
 * to behaviour the SDK exposes.
 */
interface SdkModule {
  CopilotClient: new (opts: Record<string, unknown>) => {
    start(): Promise<void>;
    stop(): Promise<void>;
    getAuthStatus(): Promise<{ isAuthenticated: boolean }>;
    createSession(opts: Record<string, unknown>): Promise<{
      sessionId: string;
      sendAndWait(message: { prompt: string }, timeoutMs: number): Promise<{ data?: { content?: string | null } }>;
      disconnect(): Promise<void>;
    }>;
  };
  approveAll: unknown;
  defineTool: (name: string, spec: Record<string, unknown>) => unknown;
}

/**
 * Installed package manifest fields the version guard reads.
 *
 * @interface InstalledManifest
 * @property {string} root - Package directory.
 * @property {string} version - Installed version.
 * @property {Record<string, string>} dependencies - Declared runtime dependencies.
 */
interface InstalledManifest {
  readonly root: string;
  readonly version: string;
  readonly dependencies: Record<string, string>;
}

/**
 * Resolve installed `@github/copilot-sdk` manifest. Package does not expose
 * its own `./package.json` through the exports map.
 *
 * @returns {InstalledManifest} The SDK's directory, version, and dependencies.
 * @throws {Error} When no `@github/copilot-sdk` manifest sits above the resolved entry.
 */
function installedSdk(): InstalledManifest {
  let dir = dirname(require.resolve('@github/copilot-sdk'));
  for (let depth = 0; depth < 8; depth += 1) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as {
        name?: string;
        version?: string;
        dependencies?: Record<string, string>;
      };
      if (parsed.name === '@github/copilot-sdk' && parsed.version) {
        return { root: dir, version: parsed.version, dependencies: parsed.dependencies ?? {} };
      }
    }
    dir = dirname(dir);
  }
  throw new Error('could not locate @github/copilot-sdk package.json');
}

/**
 * Versions of the installed `@github/copilot-sdk-<platform>` runtime packages
 * beside the SDK.
 *
 * @param {string} sdkRoot - The SDK's package directory.
 * @returns {Record<string, string>} Package name to installed version; empty when none is installed.
 */
function installedRuntimes(sdkRoot: string): Record<string, string> {
  const scope = dirname(sdkRoot);
  const runtimes: Record<string, string> = {};
  for (const entry of readdirSync(scope).filter((name) => name.startsWith('copilot-sdk-'))) {
    const parsed = JSON.parse(readFileSync(join(scope, entry, 'package.json'), 'utf8')) as { version: string };
    runtimes[`@github/${entry}`] = parsed.version;
  }
  return runtimes;
}

/**
 * Strip any ambient GitHub identity so the BYOK session cannot fall back to
 * a real Copilot login and mask a broken provider block.
 *
 * @returns {NodeJS.ProcessEnv} Copy of the environment with the tokens removed.
 */
function headlessEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'COPILOT_API_KEY']) {
    delete env[key];
  }
  return env;
}

describe('copilot-sdk dependency', () => {
  it(`is pinned to exactly ${PINNED}`, () => {
    expect(installedSdk().version).toBe(PINNED);
  });

  it(`spawns a runtime package at exactly ${PINNED}`, () => {
    const runtimes = installedRuntimes(installedSdk().root);
    expect(Object.keys(runtimes).length).toBeGreaterThan(0);
    for (const version of Object.values(runtimes)) {
      expect(version).toBe(PINNED);
    }
  });

  it('depends on no floating @github/copilot CLI', () => {
    expect(installedSdk().dependencies['@github/copilot']).toBeUndefined();
  });
});

describe.skipIf(!LIVE)('BYOK headless — Test A', () => {
  let home = '';
  afterEach(async () => {
    if (home) await rm(home, { recursive: true, force: true });
  });

  it('runs a session with no GitHub identity and reaches the BYOK provider', async () => {
    const { CopilotClient, approveAll } = (await import('@github/copilot-sdk')) as unknown as SdkModule;

    const provider = await startStubProvider(() => text('STUB_OK: reached the BYOK provider.'));
    const baseUrl = provider.baseUrl;

    home = await mkdtemp(join(tmpdir(), 'paw-sdk-a-'));
    const client = new CopilotClient({
      useLoggedInUser: false,
      env: headlessEnv(),
      baseDirectory: join(home, '.copilot-home'),
      logLevel: 'error',
    });

    try {
      await client.start();
      expect((await client.getAuthStatus()).isAuthenticated).toBe(false);

      const session = await client.createSession({
        model: 'stub-model',
        provider: { type: 'openai', baseUrl, apiKey: 'sk-stub-not-a-real-key' },
        onPermissionRequest: approveAll,
        workingDirectory: process.cwd(),
        skipCustomInstructions: true,
        enableConfigDiscovery: false,
      });
      const reply = await session.sendAndWait({ prompt: 'Say hello.' }, 60_000);
      expect(String(reply?.data?.content ?? '')).toContain('STUB_OK');
      expect(provider.requests.some((r) => r.authorization !== null)).toBe(true);
      await session.disconnect();
    } finally {
      await client.stop().catch(() => undefined);
      await provider.close();
    }
  }, 90_000);
});

describe.skipIf(!LIVE)('BYOK tool round-trip — Test B', () => {
  let home = '';
  afterEach(async () => {
    if (home) await rm(home, { recursive: true, force: true });
  });

  it('dispatches a custom tool call back into our handler with structured arguments', async () => {
    const { CopilotClient, approveAll, defineTool } = (await import('@github/copilot-sdk')) as unknown as SdkModule;

    const provider = await startStubProvider((request) =>
      request.toolResults.length === 0
        ? toolCall('submit_review', { findings: [{ file: 'src/a.ts', line: 12, severity: 'critical', summary: 'null deref' }] })
        : text('Review submitted.'),
    );
    const baseUrl = provider.baseUrl;

    let captured: unknown = null;
    const preToolUse: string[] = [];
    const submitReview = defineTool('submit_review', {
      description: 'Submit structured review findings.',
      skipPermission: true,
      parameters: {
        type: 'object',
        properties: { findings: { type: 'array', items: { type: 'object', properties: {
          file: { type: 'string' }, line: { type: 'number' },
          severity: { type: 'string' }, summary: { type: 'string' },
        }, required: ['file', 'summary'] } } },
        required: ['findings'],
      },
      handler: async (args: { findings: unknown[] }) => {
        captured = args;
        return { ok: true, received: args.findings.length };
      },
    });

    home = await mkdtemp(join(tmpdir(), 'paw-sdk-b-'));
    const client = new CopilotClient({
      useLoggedInUser: false,
      env: headlessEnv(),
      baseDirectory: join(home, '.copilot-home'),
      logLevel: 'error',
    });

    try {
      await client.start();
      const session = await client.createSession({
        model: 'stub-model',
        provider: { type: 'openai', baseUrl, apiKey: 'sk-stub' },
        onPermissionRequest: approveAll,
        tools: [submitReview],
        workingDirectory: process.cwd(),
        skipCustomInstructions: true,
        hooks: {
          onPreToolUse: (input: { toolName: string }) => {
            preToolUse.push(input.toolName);
            return { permissionDecision: 'allow' };
          },
        },
      });
      const reply = await session.sendAndWait({ prompt: 'Review the diff.' }, 60_000);
      expect(String(reply?.data?.content ?? '')).toContain('Review submitted');
      expect(captured).toEqual({ findings: [{ file: 'src/a.ts', line: 12, severity: 'critical', summary: 'null deref' }] });
      expect(preToolUse).toContain('submit_review');
      await session.disconnect();
    } finally {
      await client.stop().catch(() => undefined);
      await provider.close();
    }
  }, 90_000);
});
