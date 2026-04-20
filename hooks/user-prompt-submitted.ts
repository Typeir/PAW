/**
 * PAW Default User Prompt Submitted Hook
 *
 * @fileoverview Logs hook activity and injects L1 memory context from paw.sqlite
 * (when available) into the agent's conversation via systemMessage.
 *
 * Customize: Add project-specific prompt validation or skill pre-loading.
 *
 * @module .paw/hooks/user-prompt-submitted
 * @author PAW
 * @version 1.0.0
 * @since 3.0.0
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import {
    extractSessionId,
    readHookInput,
    writeHookOutput,
} from '../../.github/PAW/hook-runtime';
import { openDbReadonly } from '../../.github/PAW/paw-db';
import { LOG_PATH, PAW_DIR } from '../../.github/PAW/paw-paths';
import { runPlugins } from '../../.github/PAW/plugin-loader';
import { resolveStaleIndirectViolations } from '../../.github/PAW/resolve-indirect-violations';

const MAX_L1_CHARS = 800;

/**
 * Append a timestamped log entry.
 *
 * @param event - Hook payload
 */
function appendLog(event: Record<string, unknown>): void {
  mkdirSync(PAW_DIR, { recursive: true });
  const sessionId = extractSessionId(event) ?? 'unknown';
  const timestamp = new Date().toISOString();
  appendFileSync(
    LOG_PATH,
    `${timestamp} userPromptSubmitted ${sessionId}\n`,
    'utf-8',
  );
}

/**
 * Query paw.sqlite for L1 context if the database exists.
 * Returns empty string if DB has not been created yet.
 *
 * @returns Compact memory context string
 */
function loadL1Context(): string {
  const db = openDbReadonly();
  if (!db) return '';

  const facts: string[] = [];

  try {
    const decisions = db
      .prepare(
        `
      SELECT context, choice, rationale
      FROM decisions
      WHERE superseded_at IS NULL
      ORDER BY valid_from DESC
      LIMIT 5
    `,
      )
      .all() as Array<{ context: string; choice: string; rationale: string }>;

    for (const d of decisions) {
      facts.push(`Decision: ${d.context} → ${d.choice} (${d.rationale})`);
    }
  } catch {
    /* table may not exist yet */
  }

  try {
    const patterns = db
      .prepare(
        `
      SELECT name, description, occurrences
      FROM patterns
      WHERE occurrences >= 3
      ORDER BY occurrences DESC
      LIMIT 5
    `,
      )
      .all() as Array<{
      name: string;
      description: string;
      occurrences: number;
    }>;

    for (const p of patterns) {
      facts.push(`Pattern (${p.occurrences}x): ${p.name} — ${p.description}`);
    }
  } catch {
    /* table may not exist yet */
  }

  try {
    const violations = db
      .prepare(
        `
      SELECT file_path, rule, message, created_at
      FROM violations
      WHERE resolved_at IS NULL
      ORDER BY created_at DESC
      LIMIT 5
    `,
      )
      .all() as Array<{
      file_path: string;
      rule: string;
      message: string;
      created_at: string;
    }>;

    for (const v of violations) {
      facts.push(`⚠ Violation: ${v.message} (${v.file_path})`);
    }
  } catch {
    /* table may not exist yet */
  }

  db.close();

  let context = facts.join('\n');
  if (context.length > MAX_L1_CHARS) {
    context = context.slice(0, MAX_L1_CHARS) + '\n[truncated]';
  }
  return context;
}

/**
 * Main hook entrypoint.
 */
async function main(): Promise<void> {
  const hookInput = await readHookInput();
  appendLog(hookInput);

  resolveStaleIndirectViolations();

  const l1Context = loadL1Context();

  const pluginResult = await runPlugins(
    'user-prompt-submitted',
    hookInput,
    null,
  );
  const pluginMessages =
    pluginResult.messages.length > 0
      ? `\n## Plugin Notes\n${pluginResult.messages.join('\n')}`
      : '';

  if (l1Context.length > 0 || pluginMessages.length > 0) {
    writeHookOutput({
      continue: true,
      systemMessage: [
        l1Context.length > 0 ? `## PAW Memory (L1)\n${l1Context}` : '',
        pluginMessages,
      ]
        .filter(Boolean)
        .join('\n'),
    });
  } else {
    writeHookOutput({ continue: true });
  }
}

main().catch(() => {
  writeHookOutput({ continue: true });
});
