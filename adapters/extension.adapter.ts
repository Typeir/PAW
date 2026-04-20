/**
 * PAW Extension Surface Adapter
 *
 * @fileoverview Generates hooks.json in VS Code Extension-native format
 * (PascalCase events, command/windows/linux/osx command schema). This
 * unlocks Extension-only features like SubagentStart, SubagentStop, and
 * PreCompact hooks that are not available through the CLI format.
 *
 * @module .github/PAW/adapters/extension.adapter
 * @author PAW
 * @version 1.0.0
 * @since 4.0.0
 */

import { EXTENSION_EVENT_MAP, resolveEventName } from './event-map';
import type { PawHookDef, PawSurfaceAdapter, SurfaceHookOutput } from './types';
import { PawEvent } from './types';

/**
 * Extension hook command entry as written to hooks.json.
 * Uses OS-specific command overrides for platform differences.
 *
 * @interface ExtensionHookEntry
 * @property {'command'} type - Always "command" for Extension hooks
 * @property {string} command - Default command (used when no OS override matches)
 * @property {string} windows - Windows-specific command (PowerShell)
 * @property {string} linux - Linux-specific command (bash)
 * @property {string} osx - macOS-specific command (bash)
 * @property {string} cwd - Working directory (relative to project root)
 * @property {number} timeout - Max execution time in seconds
 */
interface ExtensionHookEntry {
  type: 'command';
  command: string;
  windows: string;
  linux: string;
  osx: string;
  cwd: string;
  timeout: number;
}

/**
 * Extension hooks.json structure.
 *
 * @interface ExtensionHooksJson
 * @property {number} version - Schema version (always 1)
 * @property {Record<string, ExtensionHookEntry[]>} hooks - PascalCase event-grouped entries
 */
interface ExtensionHooksJson {
  version: number;
  hooks: Record<string, ExtensionHookEntry[]>;
}

/**
 * Adapter that generates hooks.json in VS Code Extension-native format.
 * Produces PascalCase event keys and OS-specific command properties,
 * including Extension-only events (SubagentStart, SubagentStop, PreCompact).
 *
 * @implements {PawSurfaceAdapter}
 */
export class ExtensionAdapter implements PawSurfaceAdapter {
  /** @inheritdoc */
  readonly name = 'extension' as const;

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
    const eventGroups: Record<string, ExtensionHookEntry[]> = {};

    for (const hook of hooks) {
      const eventName = this.getEventName(hook.event);
      if (!eventName) continue;

      const entry = this.getCommandFormat(
        `node ${this.hookBase}/${hook.file}`,
        hook.timeoutSec,
      ) as unknown as ExtensionHookEntry;

      if (!eventGroups[eventName]) {
        eventGroups[eventName] = [];
      }
      eventGroups[eventName].push(entry);
    }

    const hooksJson: ExtensionHooksJson = { version: 1, hooks: eventGroups };

    return {
      filePath: '.github/hooks/hooks.json',
      content: JSON.stringify(hooksJson, null, 2),
    };
  }

  /** @inheritdoc */
  getEventName(event: PawEvent): string | null {
    return resolveEventName(event, EXTENSION_EVENT_MAP);
  }

  /** @inheritdoc */
  getCommandFormat(script: string, timeout: number): Record<string, unknown> {
    return {
      type: 'command',
      command: script,
      windows: script,
      linux: script,
      osx: script,
      cwd: '.',
      timeout,
    };
  }
}
