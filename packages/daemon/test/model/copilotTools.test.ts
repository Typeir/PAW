/**
 * @fileoverview Cover {@link resolveCopilotTools}: no granted name gives full
 * built-in wildcard; granted list expand to runtime's real built-in
 * identifiers (`read`→view, `edit`→edit, `search`→grep, `shell`→cross-platform
 * shell family), de-duplicate, dropping unknown names; safemode denies the whole
 * shell family through denylist, whether allowlist be wildcard or explicit grant.
 *
 * @module @paw/daemon/test/model/copilotTools
 */

import { describe, expect, it } from 'vitest';
import { resolveCopilotTools } from '../../src/infrastructure/model/copilotTools.js';

const SHELL_DENY = [
  'builtin:powershell',
  'builtin:list_powershell',
  'builtin:read_powershell',
  'builtin:stop_powershell',
  'builtin:bash',
];

describe('resolveCopilotTools', () => {
  it('grants the full built-in set when no names are declared', () => {
    expect(resolveCopilotTools(undefined, false)).toEqual({
      availableTools: ['builtin:*'],
      excludedTools: [],
    });
  });

  it('expands declared names to real built-ins, de-duplicates, and drops unknown names', () => {
    expect(resolveCopilotTools(['read', 'edit', 'search', 'shell', 'bogus'], false)).toEqual({
      availableTools: [
        'builtin:view',
        'builtin:edit',
        'builtin:grep',
        ...SHELL_DENY,
      ],
      excludedTools: [],
    });
  });

  it('denies the shell family under safemode over the wildcard', () => {
    expect(resolveCopilotTools(undefined, true)).toEqual({
      availableTools: ['builtin:*'],
      excludedTools: SHELL_DENY,
    });
  });

  it('denies the shell family under safemode over an explicit grant', () => {
    expect(resolveCopilotTools(['read', 'edit'], true)).toEqual({
      availableTools: ['builtin:view', 'builtin:edit'],
      excludedTools: SHELL_DENY,
    });
  });
});
