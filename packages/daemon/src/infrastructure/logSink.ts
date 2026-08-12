/**
 * PAW Daemon Log Sink
 *
 * @fileoverview Persists the log ring: one JSON `LogEntry` per line in
 * `.paw/daemon.log`, bounded by ENTRY COUNT — hook traffic is verbose, so the
 * cap is large and deliberate, never a dated prune. Boot loads the tail back
 * into the ring so the console backlog survives restarts. A line that does not
 * parse is skipped: a log file is telemetry, and one corrupt line must not
 * take the rest down. The codec and the trim are pure; the node sink writes
 * through `node:fs` and re-trims after every `TRIM_EVERY` appends, bounding
 * the file at cap + TRIM_EVERY entries between trims.
 *
 * @module @paw/daemon/infrastructure/logSink
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LogEntry } from '@paw/core';

/**
 * Entries the file keeps. Large: hook traffic logs per tool call.
 */
export const LOG_FILE_CAP = 10_000;

/**
 * Appends between re-trims. The file peaks at cap + this many entries.
 */
export const TRIM_EVERY = 1_000;

const LEVELS = ['info', 'warn', 'error'] as const;

/**
 * Parse one persisted line to an entry, or null when it is not one — foreign
 * or corrupt lines are skipped, never fatal.
 *
 * @param {string} line - One file line.
 * @returns {LogEntry | null} The entry, or null.
 */
export function parseLogLine(line: string): LogEntry | null {
  try {
    const parsed = JSON.parse(line) as Partial<LogEntry>;
    if (
      typeof parsed.at === 'string' &&
      typeof parsed.message === 'string' &&
      (LEVELS as readonly string[]).includes(parsed.level as string)
    ) {
      return { at: parsed.at, level: parsed.level as LogEntry['level'], message: parsed.message };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse a whole file body to entries, skipping what does not parse, keeping
 * at most the newest `cap`.
 *
 * @param {string} text - File contents.
 * @param {number} cap - Most entries to keep.
 * @returns {LogEntry[]} Entries, oldest first.
 */
export function parseLogFile(text: string, cap: number): LogEntry[] {
  return text
    .split('\n')
    .map(parseLogLine)
    .filter((entry): entry is LogEntry => entry !== null)
    .slice(-cap);
}

/**
 * What the daemon needs from a log persistence.
 *
 * @interface LogSink
 * @property {(entry: LogEntry) => void} append - Persist one entry, best effort.
 * @property {(limit: number) => LogEntry[]} load - The newest `limit` persisted entries, oldest first.
 */
export interface LogSink {
  append(entry: LogEntry): void;
  load(limit: number): LogEntry[];
}

/**
 * A sink over one JSONL file. Construction trims the file to the cap; append
 * re-trims every {@link TRIM_EVERY} entries. Filesystem failures are swallowed
 * — a daemon must not die because its log file is unwritable.
 *
 * @param {string} file - The JSONL file, e.g. `<root>/.paw/daemon.log`.
 * @param {number} [cap] - Entries the file keeps.
 * @param {number} [trimEvery] - Appends between re-trims.
 * @returns {LogSink} The sink.
 */
export function createNodeLogSink(
  file: string,
  cap: number = LOG_FILE_CAP,
  trimEvery: number = TRIM_EVERY,
): LogSink {
  let sinceTrim = 0;

  const trim = (): void => {
    try {
      if (!existsSync(file)) {
        return;
      }
      const entries = parseLogFile(readFileSync(file, 'utf8'), cap);
      writeFileSync(file, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n', 'utf8');
      sinceTrim = 0;
    } catch {}
  };

  trim();

  return {
    append: (entry: LogEntry): void => {
      try {
        mkdirSync(dirname(file), { recursive: true });
        appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
        sinceTrim += 1;
        if (sinceTrim >= trimEvery) {
          trim();
        }
      } catch {}
    },
    load: (limit: number): LogEntry[] => {
      try {
        if (!existsSync(file)) {
          return [];
        }
        return parseLogFile(readFileSync(file, 'utf8'), limit);
      } catch {
        return [];
      }
    },
  };
}
