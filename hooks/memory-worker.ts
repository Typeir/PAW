/**
 * PAW Memory Worker
 *
 * @fileoverview Async background worker spawned by post-tool-use.ts.
 * Uses the GitHub Copilot SDK to call the CLI for LLM-powered file memory
 * generation. Reads the edited file, generates a concise memory summary
 * via a mini-LLM, and stores it in paw.sqlite's file_memories table.
 *
 * Invocation: spawned as a detached child process by post-tool-use.ts
 *   npx tsx --tsconfig .paw/tsconfig.json .github/PAW/hooks/memory-worker.ts <filePath> [sessionId]
 *
 * Non-blocking: PostToolUse returns to the agent immediately after spawning.
 * Failures are logged but never propagate — they don't block the agent.
 *
 * Session lifecycle: creates an ephemeral SDK session with no sessionId so the
 * server generates a random one, then calls disconnect() + deleteSession() to
 * remove ALL state from disk immediately. No session artifacts are left behind.
 *
 * @module .github/PAW/hooks/memory-worker
 * @author Typeir
 * @version 2.0.0
 * @since 4.0.0
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
    DEFAULT_DB_PATH,
    normalizePath,
    openDb,
    upsertFileMemory,
} from '../paw-db';
import { PROJECT_ROOT } from '../paw-paths';

/** CLI args: filePath is required, sessionId is optional. */
const filePath = process.argv[2];
const sessionId = process.argv[3] ?? null;

/** Model to use for memory drafting — GPT-5 Mini. */
const MEMORY_MODEL = 'gpt-5-mini';

/**
 * Compute a SHA-256 hash of file content for staleness detection.
 *
 * @param content - File content string
 * @returns Hex-encoded SHA-256 hash
 */
function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Build the memory-drafting prompt per the memory-drafter skill contract.
 *
 * @param fp - File path (project-relative)
 * @param content - File content
 * @returns User prompt for memory generation
 */
function buildPrompt(fp: string, content: string): string {
  const ext = path.extname(fp);
  const truncated =
    content.length > 6000
      ? content.slice(0, 6000) + '\n... (truncated)'
      : content;

  return [
    'You are a code memory assistant. Given a source file, produce a concise memory note (3-5 sentences) that captures:',
    '1. What the file does (purpose, exports, key functions)',
    '2. Structural patterns (barrel exports, naming conventions, decorator usage)',
    '3. Project-specific rules inferred from the code (JSDoc style, import patterns, test colocation)',
    '4. Any non-obvious gotchas or important context for future edits',
    '',
    'Output ONLY the memory note — no headers, no markdown, no explanation.',
    '',
    `File: ${fp} (${ext})`,
    '---',
    truncated,
  ].join('\n');
}

/**
 * Check if a memory already exists for this exact file content hash.
 *
 * @param fp - Normalized file path
 * @param hash - Content hash
 * @returns True if an up-to-date memory already exists
 */
function memoryIsUpToDate(fp: string, hash: string): boolean {
  try {
    const db = openDb(DEFAULT_DB_PATH, { readonly: true });
    try {
      const row = db
        .prepare(
          'SELECT id FROM file_memories WHERE file_path = ? AND content_hash = ?',
        )
        .get(normalizePath(fp), hash) as { id: number } | undefined;
      return !!row;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

/**
 * Main worker entrypoint. Reads file, calls an ephemeral Copilot SDK session
 * for LLM inference, stores the resulting memory in paw.sqlite, then
 * immediately deletes the session to leave no workspace artifacts.
 */
async function main(): Promise<void> {
  if (!filePath) {
    process.exit(0);
  }

  const absPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(PROJECT_ROOT, filePath);

  if (!existsSync(absPath)) {
    process.exit(0);
  }

  const content = readFileSync(absPath, 'utf-8');
  const hash = contentHash(content);
  const relativePath = normalizePath(path.relative(PROJECT_ROOT, absPath));

  if (memoryIsUpToDate(relativePath, hash)) {
    process.exit(0);
  }

  const prompt = buildPrompt(relativePath, content);

  try {
    const { CopilotClient, approveAll } = await import('@github/copilot-sdk');
    const client = new CopilotClient();

    /** No sessionId — server assigns a random ephemeral ID. */
    const session = await client.createSession({
      model: MEMORY_MODEL,
      onPermissionRequest: approveAll,
      systemMessage: {
        mode: 'replace' as const,
        content:
          'You are a concise code memory assistant. Output ONLY the memory note — no headers, no markdown fences, no explanation. 3-5 sentences max.',
      },
    });

    const ephemeralId = session.sessionId;
    const response = await session.sendAndWait({ prompt }, 30_000);
    const memory = response?.data?.content?.trim();

    /** Disconnect first (closes RPC), then delete to wipe disk state instantly. */
    await session.disconnect();
    await client.deleteSession(ephemeralId);
    await client.stop();

    if (memory && memory.length > 10) {
      const db = openDb(DEFAULT_DB_PATH);
      try {
        upsertFileMemory(db, relativePath, memory, hash, sessionId);
      } finally {
        db.close();
      }
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `[memory-worker] Failed for ${relativePath}: ${msg}\n`,
    );
  }

  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(`[memory-worker] Fatal: ${error}\n`);
  process.exit(1);
});
