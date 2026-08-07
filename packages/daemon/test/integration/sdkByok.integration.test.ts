/**
 * Copilot SDK BYOK — step-0 proof
 *
 * @fileoverview Proves the pinned `@github/copilot-sdk` runs headless in this
 * repo, and guards the pin against the drift that let a raw-fetch shim displace
 * the SDK path (see `.ignore/research/byoksdk/22-byok-modelport-recovery.md` §8).
 *
 * The version guard is always-on and deterministic: it reads the installed
 * package version and fails the moment the pin is downgraded or a caret lets it
 * float. That single assertion is the anti-degradation tripwire for the whole
 * BYOK recovery — nothing below it can be built on `0.2.2`.
 *
 * The two live proofs are opt-in behind `PAW_SDK_LIVE=1` because they spawn the
 * ~159 MB Copilot runtime binary. They need no API key and spend no credit: a
 * local stub HTTP server is the BYOK provider, so they are reproducible in CI on
 * demand without a secret. Test A asserts a session runs with
 * `getAuthStatus().isAuthenticated === false` and one outbound request carrying
 * our `Authorization` header reaches the stub. Test B dispatches a custom
 * `defineTool` call back into our handler with structured arguments — the tool
 * surface a raw completions POST cannot carry, and the capability the eventual
 * real `SessionRun` depends on.
 *
 * @module @paw/daemon/test/integration/sdkByok
 */

import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const PINNED = '1.0.8';
const LIVE = process.env.PAW_SDK_LIVE === '1';

/**
 * The minimal slice of the SDK surface these proofs exercise, declared locally
 * so the test binds to behaviour rather than to the SDK's full type shape.
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
 * Resolve the installed `@github/copilot-sdk` version without relying on the
 * package exposing `./package.json` through its exports map.
 *
 * @returns {string} The installed version string.
 */
function installedSdkVersion(): string {
  let dir = dirname(require.resolve('@github/copilot-sdk'));
  for (let depth = 0; depth < 8; depth += 1) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string; version?: string };
      if (parsed.name === '@github/copilot-sdk' && parsed.version) return parsed.version;
    }
    dir = dirname(dir);
  }
  throw new Error('could not locate @github/copilot-sdk package.json');
}

/**
 * Strip any ambient GitHub identity so a BYOK session cannot silently fall back
 * to a real Copilot login and mask a broken provider block.
 *
 * @returns {NodeJS.ProcessEnv} A copy of the environment with the tokens removed.
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
    expect(installedSdkVersion()).toBe(PINNED);
  });
});

describe.skipIf(!LIVE)('BYOK headless — Test A', () => {
  let home = '';
  afterEach(async () => {
    if (home) await rm(home, { recursive: true, force: true });
  });

  it('runs a session with no GitHub identity and reaches the BYOK provider', async () => {
    const { CopilotClient, approveAll } = (await import('@github/copilot-sdk')) as unknown as SdkModule;

    let sawAuthHeader = false;
    const server = createServer((req, res) => {
      sawAuthHeader ||= Boolean(req.headers.authorization);
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-stub', object: 'chat.completion', created: 1, model: 'stub-model',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'STUB_OK: reached the BYOK provider.' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }));
      });
    });
    const baseUrl = await new Promise<string>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}/v1`);
      });
    });

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
      expect(sawAuthHeader).toBe(true);
      await session.disconnect();
    } finally {
      await client.stop().catch(() => undefined);
      await new Promise<void>((resolve) => server.close(() => resolve()));
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

    let turn = 0;
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        turn += 1;
        const toolCall = {
          id: 'chatcmpl-1', object: 'chat.completion', created: 1, model: 'stub-model',
          choices: [{ index: 0, finish_reason: 'tool_calls', message: {
            role: 'assistant', content: null,
            tool_calls: [{ id: 'call_1', type: 'function', function: {
              name: 'submit_review',
              arguments: JSON.stringify({ findings: [{ file: 'src/a.ts', line: 12, severity: 'critical', summary: 'null deref' }] }),
            } }],
          } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        };
        const done = {
          id: 'chatcmpl-2', object: 'chat.completion', created: 1, model: 'stub-model',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Review submitted.' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(turn === 1 ? toolCall : done));
      });
    });
    const baseUrl = await new Promise<string>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}/v1`);
      });
    });

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
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 90_000);
});
