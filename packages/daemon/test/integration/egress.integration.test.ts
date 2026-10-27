/**
 * @fileoverview Live egress suite: PAW's `openSdkModel` on the bundled Copilot
 * runtime, a stub provider, and an egress watch over this process tree. Proves
 * model traffic leaves only through PAW egress, GitHub-API built-ins stay out,
 * and every offered built-in is called once under the watch. Opt-in behind
 * `PAW_SDK_LIVE=1`; Windows only.
 *
 * @module @paw/daemon/test/integration/egress
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openSdkModel } from '../../src/infrastructure/model/sdkModel.js';
import { startEgressWatch, type EgressReport, type EgressWatch } from '../support/egressWatch.js';
import { startStubProvider, text, toolCall, type StubProvider, type StubRequest, type StubTurn } from '../support/stubProvider.js';

const LIVE = process.env.PAW_SDK_LIVE === '1';
const KEY = 'sk-stub-egress';
const SWEEP_MARK = 'EGRESS-SWEEP:';
const SUBAGENT_MARK = 'EGRESS-SUBAGENT';

/**
 * Built-ins whose job is egress, and what they reach. Their egress is not
 * counted against the sweep.
 */
const EGRESS_BY_DESIGN: Readonly<Record<string, string>> = {
  web_fetch: 'the public URL the model names; the runtime refuses loopback, private, link-local, and reserved hosts',
};

/**
 * Arguments the sweep calls each built-in with. An offered built-in missing
 * here fails the inventory test until it is probed or denied in `copilotTools.ts`.
 * `web_fetch` names a reserved host, which the runtime refuses before any egress.
 *
 * @param {string} repo - Working directory the member runs in.
 * @returns {Readonly<Record<string, unknown>>} Built-in name to arguments.
 */
function sweepArgs(repo: string): Readonly<Record<string, unknown>> {
  return {
    powershell: { command: 'Get-ChildItem', description: 'list the repository' },
    read_powershell: { shellId: 'egress-probe', delay: 0 },
    stop_powershell: { shellId: 'egress-probe' },
    list_powershell: {},
    bash: { command: 'ls', description: 'list the repository' },
    view: { path: join(repo, 'README.md') },
    create: { path: join(repo, 'created.md'), file_text: 'created\n' },
    edit: { path: join(repo, 'README.md'), old_str: 'readme body', new_str: 'readme edited' },
    grep: { pattern: 'readme', paths: repo },
    glob: { pattern: '*.md', paths: repo },
    web_fetch: { url: 'https://egress-sweep.invalid/' },
    run_dynamic_workflow: { name: 'egress-probe' },
    dynamic_workflows_manage: { operation: 'list' },
    sql: { description: 'egress probe', query: 'select 1' },
    read_agent: { agent_id: 'egress-probe' },
    list_agents: {},
    write_agent: { agent_id: 'egress-probe', message: 'egress probe' },
    task: { name: 'egress-probe', description: 'egress probe', agent_type: 'explore', prompt: `${SUBAGENT_MARK}: reply done` },
  };
}

/**
 * Sweep script: a subagent answers at once; a member calls the built-in its
 * prompt names, once, then answers.
 *
 * @param {Readonly<Record<string, unknown>>} args - Arguments per built-in.
 * @returns {(request: StubRequest) => StubTurn} The script.
 */
function sweepScript(args: Readonly<Record<string, unknown>>): (request: StubRequest) => StubTurn {
  return (request) => {
    if (request.prompt.includes(SUBAGENT_MARK)) {
      return text('subagent done');
    }
    const tool = new RegExp(`${SWEEP_MARK}(\\S+)`).exec(request.prompt)?.[1] ?? '';
    return request.toolResults.length === 0 && request.offeredTools.includes(tool)
      ? toolCall(tool, args[tool])
      : text('done');
  };
}

/**
 * Requests that reached the provider without PAW's egress key.
 *
 * @param {StubProvider} provider - Stub provider.
 * @returns {string[]} Path and authorization of each unkeyed request.
 */
function unkeyed(provider: StubProvider): string[] {
  return provider.requests
    .filter((r) => r.authorization !== `Bearer ${KEY}`)
    .map((r) => `${r.path} authorization=${r.authorization}`);
}

describe.skipIf(!LIVE)('egress (live)', () => {
  let watch: EgressWatch;
  let home = '';
  let repo = '';
  let sessions = 0;

  /**
   * Run `body` against PAW's SDK model on a fresh runtime home.
   *
   * @param {StubProvider} provider - Provider the model points at.
   * @param {(complete: (prompt: string) => Promise<string>) => Promise<void>} body - Drives completions.
   * @returns {Promise<void>} Resolves once the client stopped.
   */
  async function withModel(
    provider: StubProvider,
    body: (complete: (prompt: string) => Promise<string>) => Promise<void>,
  ): Promise<void> {
    sessions += 1;
    const { port, close } = await openSdkModel({
      provider: { type: 'openai', baseUrl: provider.baseUrl },
      authToken: () => KEY,
      baseDirectory: join(home, `copilot-${sessions}`),
      workingDirectory: repo,
      safemode: false,
      hooks: {},
    });
    try {
      await body(async (prompt) => (await port.complete({ model: 'stub-model', prompt })).content);
    } finally {
      await close();
    }
  }

  /**
   * Assert a report holds no egress and no watch failure.
   *
   * @param {EgressReport} report - Watch report.
   * @returns {void}
   */
  function expectNoEgress(report: EgressReport): void {
    expect(report.failures).toEqual([]);
    expect(report.proxied).toEqual([]);
    expect(report.connections).toEqual([]);
  }

  beforeAll(async () => {
    watch = await startEgressWatch();
    await watch.prove();
    home = await mkdtemp(join(tmpdir(), 'paw-egress-'));
    repo = join(home, 'repo');
    await mkdir(repo);
    await writeFile(join(repo, 'README.md'), 'readme body\n', 'utf8');
  }, 60_000);

  afterAll(async () => {
    await watch.stop();
    await rm(home, { recursive: true, force: true });
  });

  it('sends every model request of a member run through PAW egress, and nothing else leaves', async () => {
    watch.reset();
    const provider = await startStubProvider((request) =>
      request.toolResults.length === 0
        ? toolCall('view', { path: join(repo, 'README.md') })
        : request.toolResults.length === 1
          ? toolCall('grep', { pattern: 'readme', paths: repo })
          : text('done'),
    );
    try {
      await withModel(provider, async (complete) => {
        expect(await complete('Read the readme, grep it, then say done.')).toBe('done');
      });
      expect(provider.requests.length).toBeGreaterThanOrEqual(3);
      expect(unkeyed(provider)).toEqual([]);
      expectNoEgress(watch.report());
      expect(watch.report().processes, 'the runtime must run inside the watched tree').toContain('copilot-runtime.exe');
    } finally {
      await provider.close();
    }
  }, 120_000);

  it('offers no GitHub-API built-in and refuses one a member names', async () => {
    watch.reset();
    const provider = await startStubProvider((request) =>
      request.toolResults.length === 0
        ? toolCall('semantic_code_search', { query: 'readme', repo: 'github/copilot-sdk' })
        : text('done'),
    );
    try {
      await withModel(provider, async (complete) => {
        await complete('Search the code.');
      });
      expect(provider.requests[0]?.offeredTools).not.toContain('semantic_code_search');
      expect(provider.requests[1]?.toolResults[0]).toContain("'semantic_code_search' does not exist");
      expect(unkeyed(provider)).toEqual([]);
      expectNoEgress(watch.report());
    } finally {
      await provider.close();
    }
  }, 120_000);

  it('offers members only built-ins the sweep calls', async () => {
    const provider = await startStubProvider(() => text('done'));
    try {
      await withModel(provider, async (complete) => {
        await complete('Say done.');
      });
      const offered = provider.requests[0]?.offeredTools ?? [];
      expect(offered.length).toBeGreaterThan(0);
      expect(
        offered.filter((tool) => !(tool in sweepArgs(repo))),
        'built-ins offered to members but never probed: give each sweep arguments, or deny it in copilotTools.ts',
      ).toEqual([]);
    } finally {
      await provider.close();
    }
  }, 120_000);

  it('calls every offered built-in once; only built-ins whose job is egress leave the machine', async () => {
    const args = sweepArgs(repo);
    const provider = await startStubProvider(sweepScript(args));
    const reports = new Map<string, EgressReport>();
    const results = new Map<string, string>();
    try {
      await withModel(provider, async (complete) => {
        await complete(`${SWEEP_MARK}none`);
        for (const tool of provider.requests[0]?.offeredTools ?? []) {
          watch.reset();
          await complete(`${SWEEP_MARK}${tool}`);
          reports.set(tool, watch.report());
          results.set(tool, provider.requests.filter((r) => r.toolResults.length > 0).at(-1)?.toolResults[0] ?? '');
        }
      });
      expect([...reports.keys()].length).toBeGreaterThan(0);
      const unexpected = [...reports]
        .filter(([tool]) => !(tool in EGRESS_BY_DESIGN))
        .flatMap(([tool, report]) => [
          ...report.connections.map((c) => `${tool}: tcp ${c} after "${results.get(tool)}"`),
          ...report.proxied.map((line) => `${tool}: proxied ${line} after "${results.get(tool)}"`),
        ]);
      expect(unexpected, 'egress outside PAW, by built-in').toEqual([]);
      expect(watch.report().failures).toEqual([]);
      expect(unkeyed(provider)).toEqual([]);
    } finally {
      await provider.close();
    }
  }, 300_000);
});
