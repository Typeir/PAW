/**
 * PAW Copilot Tool Resolver
 *
 * @fileoverview Map PAW canonical tool name to Copilot built-in name, one
 * session. Copilot own resolver, name differ across SDK. Plan grant canonical
 * (`read`, `edit`, `search`, `shell`) via `availableTools` / `resolveTools`;
 * turn into allow/deny list for `createSession`. No grant → full built-in set
 * (`builtin:*`, option B). Safemode deny shell family via denylist;
 * `mode:'empty'` obey deny over allow. Built-in name maps `view` to read,
 * `edit` to edit, `grep` to search; shell is `powershell` family on Windows or
 * `bash` POSIX. Both named — map stay platform-agnostic, unregistered name inert.
 *
 * @module @paw/daemon/model/copilotTools
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Across host, shell built-in: `powershell` family on Windows, `bash` POSIX.
 * Name both — resolver branch no host; unregistered name inert.
 */
const SHELL_BUILTINS: readonly string[] = [
  'powershell',
  'list_powershell',
  'read_powershell',
  'stop_powershell',
  'bash',
];

/**
 * Canonical name → Copilot built-in grant. `read`=view, `edit`=edit,
 * `search`=grep, `shell`=whole shell family. Name outside map grant nothing.
 */
const CANONICAL_TO_BUILTIN: Readonly<Record<string, readonly string[]>> = {
  read: ['view'],
  edit: ['edit'],
  search: ['grep'],
  shell: SHELL_BUILTINS,
};

/**
 * Copilot allow/deny filter, one session.
 *
 * @interface CopilotToolFilter
 * @property {string[]} availableTools - Allowlist for `createSession`: `builtin:` patterns, or `builtin:*` when plan grant no name.
 * @property {string[]} excludedTools - Denylist. Safemode → shell family, else empty. `mode:'empty'` apply it over allowlist.
 */
export interface CopilotToolFilter {
  readonly availableTools: string[];
  readonly excludedTools: string[];
}

/**
 * Resolve canonical name to allow/deny filter. Undefined → full built-in set.
 * Granted list → expand to built-in, dedupe, qualify; drop unknown name. Safemode
 * deny shell family, whatever allowlist.
 *
 * @param {readonly string[] | undefined} canonical - Granted canonical name, undefined → full set.
 * @param {boolean} safemode - True → deny shell (option-A surface).
 * @returns {CopilotToolFilter} Allowlist and denylist for `createSession`.
 */
export function resolveCopilotTools(
  canonical: readonly string[] | undefined,
  safemode: boolean,
): CopilotToolFilter {
  const availableTools =
    canonical === undefined
      ? ['builtin:*']
      : [
          ...new Set(
            canonical
              .flatMap((name) => CANONICAL_TO_BUILTIN[name] ?? [])
              .map((name) => `builtin:${name}`),
          ),
        ];
  const excludedTools = safemode ? SHELL_BUILTINS.map((name) => `builtin:${name}`) : [];
  return { availableTools, excludedTools };
}
