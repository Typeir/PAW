/**
 * PAW Plugin Types
 *
 * @fileoverview Contract types for the PAW plugin system. Plugins live in
 * `.paw/plugins/{hook-name}/` and are auto-discovered by the plugin loader.
 * They run alongside framework hooks and their decisions are compounded:
 * if ANY plugin OR the framework hook says "block", the final result blocks.
 *
 * @module .github/PAW/plugin-types
 * @author Typeir
 * @version 1.0.0
 * @since 4.0.0
 */

import type { PawDatabase } from './paw-db';

/**
 * Result returned by a plugin's run() function.
 *
 * @interface PluginResult
 * @property {boolean} block - True to signal a blocking condition
 * @property {string} [message] - Human-readable explanation (shown to agent when block=true)
 */
export interface PluginResult {
  block: boolean;
  message?: string;
}

/**
 * Contract every plugin file must satisfy. Export a default or named `plugin`
 * constant implementing this interface.
 *
 * @interface PawPlugin
 * @property {string} name - Display name for logging and diagnostics
 * @property {Function} run - Plugin handler receiving the hook input and an optional DB handle
 */
export interface PawPlugin {
  name: string;
  run(
    hookInput: Record<string, unknown>,
    db: PawDatabase | null,
  ): Promise<PluginResult>;
}

/**
 * Aggregated result from running all plugins for a hook event.
 *
 * @interface AggregatePluginResult
 * @property {boolean} block - True if ANY plugin returned block=true
 * @property {Array<string>} messages - Collected messages from blocking plugins
 */
export interface AggregatePluginResult {
  block: boolean;
  messages: string[];
}
