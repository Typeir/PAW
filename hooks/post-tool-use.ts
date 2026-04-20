/**
 * PAW Post Tool Use Hook
 *
 * @fileoverview Two-layer post-tool-use processing:
 *   Layer 1 (sync): Run quality gates on the edited file, write violations,
 *   block agent if critical issues exist.
 *   Layer 2 (async): Spawn a detached memory-worker process that uses the
 *   Copilot SDK CLI to generate file-specific memories for L1 injection.
 *
 * Violations are stored in paw.sqlite. The enforcement loop:
 *   1. postToolUse runs gates on edited file → inserts findings into SQLite → blocks
 *   2. preToolUse queries SQLite for unresolved → denies non-exempt tools
 *   3. Agent fixes file → postToolUse re-runs gates → resolves in SQLite
 *   4. preToolUse queries SQLite → no unresolved → allows tools again
 *
 * Design rules:
 *   - No network in sync path — must work offline
 *   - Fail open — catch-all returns { continue: true }
 *   - Gates are the single source of truth for project rules
 *   - Memory worker is fire-and-forget — failures never block the agent
 *
 * @module .github/PAW/hooks/post-tool-use
 * @author PAW
 * @version 10.0.0
 * @since 3.0.0
 */

import { spawn, type SpawnOptions } from 'node:child_process';
import path from 'node:path';

import {
    extractSessionId,
    readHookInput,
    resolveEditedFilePath,
    writeHookOutput,
} from '../hook-runtime';
import {
    DEFAULT_DB_PATH,
    getPawConfig,
    insertViolation,
    normalizePath,
    openDb,
    openDbReadonly,
    resolveViolationsForFile,
} from '../paw-db';
import {
    isPathIgnored,
    PROJECT_ROOT as ROOT,
    toProjectRelative,
} from '../paw-paths';
import { runGatesForFiles } from '../pawGates';
import { runPlugins } from '../plugin-loader';
import { resolveStaleIndirectViolations } from '../resolve-indirect-violations';

/**
 * Persist gate findings for a file into SQLite, scoped to the current session.
 *
 * @param {string} filePath - Normalized file path
 * @param {Array<{ rule: string; message: string }>} findings - Gate findings
 * @param {string | null} sessionId - Current session ID
 */
async function writeViolations(
  filePath: string,
  findings: Array<{ rule: string; message: string; indirectFix?: boolean }>,
  sessionId: string | null,
): Promise<void> {
  try {
    const db = await openDb(DEFAULT_DB_PATH);
    try {
      for (const finding of findings) {
        insertViolation(db, {
          filePath: normalizePath(filePath),
          rule: finding.rule,
          message: finding.message,
          hookEvent: 'postToolUse',
          sessionId: sessionId ?? undefined,
          indirectFix: finding.indirectFix,
        });
      }
    } finally {
      db.close();
    }
  } catch {
    /* DB failure — fail open */
  }
}

/**
 * Resolve violations for a file — clears both session-scoped and
 * project-scoped (NULL session_id) violations.
 * When a file passes all gates, any stale project-scoped violation
 * (e.g. from manual test runs without a session_id) is also cleared
 * so the enforcement loop can complete correctly.
 *
 * @param {string} filePath - File path whose violations are resolved
 * @param {string | null} sessionId - Current session ID
 */
async function clearViolations(filePath: string, sessionId: string | null): Promise<void> {
  try {
    const db = await openDb(DEFAULT_DB_PATH);
    try {
      /** Always clear project-scoped (NULL session) violations for clean files. */
      resolveViolationsForFile(db, normalizePath(filePath), null);
      /** Also clear session-scoped violations when a session is known. */
      if (sessionId) {
        resolveViolationsForFile(db, normalizePath(filePath), sessionId);
      }
    } finally {
      db.close();
    }
  } catch {
    /* DB failure — fail open */
  }
}

/**
 * Spawn the memory worker as a background process.
 * The worker generates file memories via the Copilot SDK and stores them
 * in paw.sqlite for future L1 injection. Failures are silent.
 *
 * On non-Windows: detached + unref → fire-and-forget, parent exits immediately.
 * On Windows: detached allocates a visible console (Node.js platform quirk).
 * Instead we spawn non-detached and return a Promise that resolves when the
 * child exits. The caller must write hook output BEFORE awaiting this promise
 * so the agent is unblocked while the hook process waits for the worker to
 * finish within the 15 s hook timeout.
 *
 * @param {string} relativePath - Project-relative file path
 * @param {string | null} sessionId - Current session ID
 * @returns {Promise<void>} Resolves immediately on non-Windows; on Windows
 *   resolves when the child process exits (or on error).
 */
function spawnMemoryWorker(
  relativePath: string,
  sessionId: string | null,
): Promise<void> {
  return new Promise((resolve) => {
    try {
      const workerPath = path.join(
        ROOT,
        '.github',
        'PAW',
        'hooks',
        'memory-worker.ts',
      );
      const tsconfigPath = path.join(ROOT, '.paw', 'tsconfig.json');
      const tsxCli = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
      const isWindows = process.platform === 'win32';

      const spawnOpts: SpawnOptions = {
        cwd: ROOT,
        stdio: 'ignore',
        windowsHide: true,
      };

      if (!isWindows) {
        spawnOpts.detached = true;
      }

      const child = spawn(
        process.execPath,
        [
          tsxCli,
          '--tsconfig',
          tsconfigPath,
          workerPath,
          relativePath,
          ...(sessionId ? [sessionId] : []),
        ],
        spawnOpts,
      );

      if (isWindows) {
        child.on('exit', () => resolve());
        child.on('error', () => resolve());
      } else {
        child.unref();
        resolve();
      }
    } catch {
      resolve();
    }
  });
}

/**
 * Main hook entrypoint.
 */
async function main(): Promise<void> {
  try {
    const cfgDb = await openDbReadonly(DEFAULT_DB_PATH);
    if (cfgDb) {
      try {
        if (getPawConfig(cfgDb, 'paw_state') === 'disabled') {
          writeHookOutput({ continue: true });
          return;
        }
      } finally {
        cfgDb.close();
      }
    }
  } catch {
    /* fail open */
  }

  const hookInput = readHookInput();
  const filePath = resolveEditedFilePath(hookInput);
  const sessionId = extractSessionId(hookInput);

  if (!filePath) {
    writeHookOutput({ continue: true });
    return;
  }

  const relativePath = toProjectRelative(filePath);

  /** Skip files excluded by .pawignore or PAW's built-in exclusions. */
  if (isPathIgnored(relativePath)) {
    await clearViolations(relativePath, sessionId);
    writeHookOutput({ continue: true });
    return;
  }

  const report = await runGatesForFiles(ROOT, [relativePath]);

  const criticalFindings = report.gates
    .filter((g) => !g.passed && g.severity === 'critical')
    .flatMap((g) => g.findings);

  if (criticalFindings.length === 0) {
    await clearViolations(relativePath, sessionId);
    await resolveStaleIndirectViolations(sessionId);
    writeHookOutput({ continue: true });
    await spawnMemoryWorker(relativePath, sessionId);
    return;
  }

  await clearViolations(relativePath, sessionId);
  await writeViolations(relativePath, criticalFindings, sessionId);

  const pluginResult = await runPlugins('post-tool-use', hookInput, null);

  const message = [
    `⚠️ Gate violations in ${relativePath}:`,
    ...criticalFindings.slice(0, 10).map((f: any) => {
      const loc = f.line ? `:${f.line}` : '';
      return `  - [${f.rule}] ${f.message}${loc}`;
    }),
    criticalFindings.length > 10
      ? `  ... and ${criticalFindings.length - 10} more`
      : '',
    '',
    'Fix these before continuing.',
  ]
    .filter(Boolean)
    .join('\n');

  writeHookOutput({
    continue: true,
    decision: 'block',
    reason: message,
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: message,
    },
  });
  await spawnMemoryWorker(relativePath, sessionId);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `PAW postToolUse error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  writeHookOutput({ continue: true });
});
