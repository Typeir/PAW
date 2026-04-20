/**
 * PAW CLI Surface Adapter
 *
 * @fileoverview Generates hooks.json in Copilot CLI format (camelCase events,
 * bash/powershell commands). This is an extraction of the original inline
 * generation logic from `pawSync.ts` into the adapter pattern.
 *
 * Output format matches what Copilot CLI reads natively and what VS Code
 * auto-converts (camelCase → PascalCase, bash → linux+osx, powershell → windows).
 *
 * @module .github/PAW/adapters/cli.adapter
 * @author Typeir
 * @version 1.0.0
 * @since 4.0.0
 */

import { CLI_EVENT_MAP, resolveEventName } from './event-map';
import type { PawHookDef, PawSurfaceAdapter, SurfaceHookOutput } from './types';
import { PawEvent } from './types';

/**
 * CLI hook command entry as written to hooks.json.
 *
 * @interface CLIHookEntry
 * @property {'command'} type - Always "command" for CLI hooks
 * @property {string} bash - Shell command for bash (macOS/Linux)
 * @property {string} powershell - Shell command for PowerShell (Windows)
 * @property {string} cwd - Working directory (relative to project root)
 * @property {number} timeoutSec - Max execution time in seconds
 */
interface CLIHookEntry {
  type: 'command';
  bash: string;
  powershell: string;
  cwd: string;
  timeoutSec: number;
}

/**
 * CLI hooks.json structure.
 *
 * @interface CLIHooksJson
 * @property {number} version - Schema version (always 1)
 * @property {Record<string, CLIHookEntry[]>} hooks - Event-grouped hook entries
 */
interface CLIHooksJson {
  version: number;
  hooks: Record<string, CLIHookEntry[]>;
}

/**
 * Adapter that generates hooks.json in Copilot CLI format.
 * This is the default adapter and produces output identical to the
 * original `pawSync.ts` inline generation.
 *
 * @implements {PawSurfaceAdapter}
 */
export class CLIAdapter implements PawSurfaceAdapter {
  /** @inheritdoc */
  readonly name = 'cli' as const;

  /**
   * Relative path to the hooks directory from project root.
   */
  private readonly hookBase: string;

  /**
   * @param hookBase - Relative path to .paw/hooks/ directory
   */
  constructor(hookBase: string = '.paw/hooks') {
    this.hookBase = hookBase;
  }

  /** @inheritdoc */
  generateHookConfig(hooks: PawHookDef[]): SurfaceHookOutput {
    const eventGroups: Record<string, CLIHookEntry[]> = {};

    for (const hook of hooks) {
      const eventName = this.getEventName(hook.event);
      if (!eventName) continue;

      const entry = this.getCommandFormat(
        `node ${this.hookBase}/${hook.file}`,
        hook.timeoutSec,
      ) as unknown as CLIHookEntry;

      if (!eventGroups[eventName]) {
        eventGroups[eventName] = [];
      }
      eventGroups[eventName].push(entry);
    }

    const hooksJson: CLIHooksJson = { version: 1, hooks: eventGroups };

    return {
      filePath: '.github/hooks/hooks.json',
      content: JSON.stringify(hooksJson, null, 2),
    };
  }

  /** @inheritdoc */
  getEventName(event: PawEvent): string | null {
    return resolveEventName(event, CLI_EVENT_MAP);
  }

  /** @inheritdoc */
  getCommandFormat(script: string, timeout: number): Record<string, unknown> {
    return {
      type: 'command',
      bash: script,
      powershell: script,
      cwd: '.',
      timeoutSec: timeout,
    };
  }
}
