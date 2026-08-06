/**
 * Brief Composition Tests
 *
 * @fileoverview What a member is actually sent: a brief alone when the plan
 * attaches nothing, and a brief followed by each attached file's contents when
 * it does — in the order the plan declared them, fenced under their own paths.
 * A file that cannot be read fails the composition rather than dropping out of
 * the prompt.
 *
 * @module @paw/core/test/application/composeBrief
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import { composeBrief, CONTEXT_HEADING } from '../../src/application/composeBrief.js';
import type { SwarmPlan } from '../../src/domain/swarm.js';
import type { FileReaderPort } from '../../src/ports/index.js';

const files: FileReaderPort = {
  read: async (path) => {
    if (path === 'style.md') {
      return 'be terse';
    }
    if (path === 'src/a.ts') {
      return 'export {};';
    }
    throw new Error(`no such file: ${path}`);
  },
};

const plan = (
  over: Partial<SwarmPlan<{ n: number }>> = {},
): SwarmPlan<{ n: number }> => ({
  name: 'demo',
  role: 'edit.apply',
  args: { n: 2 },
  members: 2,
  brief: (_a, m) => `brief-${m}`,
  ...over,
});

describe('composeBrief', () => {
  it('sends the brief unchanged when nothing is attached', async () => {
    await expect(composeBrief(plan(), 0, files)).resolves.toBe('brief-0');
    await expect(composeBrief(plan({ contextFiles: () => [] }), 0, files)).resolves.toBe('brief-0');
  });

  it('appends each attached file under its own path, in declaration order', async () => {
    const prompt = await composeBrief(
      plan({ contextFiles: () => ['style.md', 'src/a.ts'] }),
      1,
      files,
    );
    expect(prompt).toBe(
      `brief-1\n\n${CONTEXT_HEADING}\n### style.md\n\`\`\`\nbe terse\n\`\`\`\n\n### src/a.ts\n\`\`\`\nexport {};\n\`\`\``,
    );
  });

  it('attaches only what the member itself declared', async () => {
    const perMember = plan({ contextFiles: (_a, m) => (m === 0 ? ['style.md'] : []) });
    expect(await composeBrief(perMember, 0, files)).toContain('be terse');
    expect(await composeBrief(perMember, 1, files)).toBe('brief-1');
  });

  it('fails rather than quietly dropping a file it cannot read', async () => {
    await expect(
      composeBrief(plan({ contextFiles: () => ['missing.md'] }), 0, files),
    ).rejects.toThrow('no such file: missing.md');
  });
});
