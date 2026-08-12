/**
 * @fileoverview Cover the log sink over a real temp filesystem: line and file
 * parsing skip what does not parse, append/load round-trips JSONL, boot
 * construction trims an over-cap file, appends re-trim on the interval, and
 * every filesystem failure is swallowed — the sink is telemetry and never
 * takes the daemon down.
 *
 * @module @paw/daemon/test/logSink
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LogEntry } from '@paw/core';
import { createNodeLogSink, parseLogFile, parseLogLine } from '../src/infrastructure/logSink.js';

const entry = (n: number, level: LogEntry['level'] = 'info'): LogEntry => ({
  at: `2026-08-11T10:00:${String(n % 60).padStart(2, '0')}.000Z`,
  level,
  message: `m${n}`,
});

const dirs: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'paw-logsink-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('parseLogLine', () => {
  it('round-trips a serialized entry', () => {
    expect(parseLogLine(JSON.stringify(entry(1, 'warn')))).toEqual(entry(1, 'warn'));
  });

  it('skips corrupt json, unknown levels, and wrong field types', () => {
    expect(parseLogLine('not json')).toBeNull();
    expect(parseLogLine('{"at":"t","level":"debug","message":"m"}')).toBeNull();
    expect(parseLogLine('{"at":1,"level":"info","message":"m"}')).toBeNull();
    expect(parseLogLine('{"at":"t","level":"info","message":2}')).toBeNull();
  });
});

describe('parseLogFile', () => {
  it('keeps the newest cap entries, skipping foreign lines', () => {
    const text = [
      'garbage',
      JSON.stringify(entry(1)),
      '',
      JSON.stringify(entry(2)),
      JSON.stringify(entry(3)),
    ].join('\n');
    expect(parseLogFile(text, 2)).toEqual([entry(2), entry(3)]);
  });
});

describe('createNodeLogSink', () => {
  it('appends entries and loads the newest tail back, oldest first', () => {
    const file = join(tempDir(), '.paw', 'daemon.log');
    const sink = createNodeLogSink(file);
    sink.append(entry(1));
    sink.append(entry(2, 'error'));
    sink.append(entry(3));
    expect(sink.load(2)).toEqual([entry(2, 'error'), entry(3)]);
    expect(createNodeLogSink(file).load(10)).toEqual([entry(1), entry(2, 'error'), entry(3)]);
  });

  it('trims an over-cap file at construction', () => {
    const file = join(tempDir(), 'daemon.log');
    writeFileSync(file, Array.from({ length: 9 }, (_v, i) => JSON.stringify(entry(i))).join('\n'), 'utf8');
    createNodeLogSink(file, 4);
    const kept = parseLogFile(readFileSync(file, 'utf8'), 100);
    expect(kept).toHaveLength(4);
    expect(kept[0]).toEqual(entry(5));
  });

  it('re-trims after the append interval, bounding the file', () => {
    const file = join(tempDir(), 'daemon.log');
    const sink = createNodeLogSink(file, 3, 2);
    for (let i = 0; i < 7; i += 1) {
      sink.append(entry(i));
    }
    const kept = parseLogFile(readFileSync(file, 'utf8'), 100);
    expect(kept.length).toBeLessThanOrEqual(5);
    expect(kept[kept.length - 1]).toEqual(entry(6));
  });

  it('swallows filesystem failures when the target path is a directory', () => {
    const dir = tempDir();
    const sink = createNodeLogSink(dir);
    expect(() => sink.append(entry(1))).not.toThrow();
    expect(sink.load(5)).toEqual([]);
  });

  it('loads nothing from a file that does not exist', () => {
    expect(createNodeLogSink(join(tempDir(), 'missing.log')).load(5)).toEqual([]);
  });
});
