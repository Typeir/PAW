/**
 * Logs View
 *
 * @fileoverview The daemon log, filtered by level and substring. Entries come
 * from the snapshot ring and grow over the live `log` topic; the view holds
 * only the filters. Newest render last, in a scrolling box.
 *
 * @module @paw/gui/presentation/views/logsView
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { LogEntry } from '@paw/core';
import { useState } from 'react';
import { useConsoleData } from '../../application/hooks/useConsole.js';
import { Card } from '../atoms/card.js';
import { Crumb } from '../atoms/crumb.js';
import { Placeholder } from '../atoms/placeholder.js';

/**
 * Level filter values: every level, or one of them.
 */
type LevelFilter = 'all' | LogEntry['level'];

/**
 * Apply the filters to the entries. Substring matches case-insensitively
 * against the message.
 *
 * @param {readonly LogEntry[]} entries - Entries, oldest first.
 * @param {LevelFilter} level - Level to keep, or `all`.
 * @param {string} needle - Substring the message must contain; blank keeps all.
 * @returns {LogEntry[]} What survives.
 */
export function filterLogs(
  entries: readonly LogEntry[],
  level: LevelFilter,
  needle: string,
): LogEntry[] {
  const query = needle.trim().toLowerCase();
  return entries.filter(
    (entry) =>
      (level === 'all' || entry.level === level) &&
      (query === '' || entry.message.toLowerCase().includes(query)),
  );
}

/**
 * The clock part of an ISO timestamp, for a compact row.
 *
 * @param {string} at - ISO-8601 timestamp.
 * @returns {string} `HH:MM:SS`.
 */
function clockOf(at: string): string {
  return at.slice(11, 19);
}

/**
 * The daemon log with a filter bar.
 *
 * @returns {JSX.Element} The view.
 */
export function LogsView() {
  const { logs } = useConsoleData();
  const [level, setLevel] = useState<LevelFilter>('all');
  const [needle, setNeedle] = useState('');

  const shown = filterLogs(logs, level, needle);
  const meta =
    logs.length === 0
      ? 'nothing logged yet'
      : `${shown.length} of ${logs.length} entr${logs.length === 1 ? 'y' : 'ies'}`;

  return (
    <>
      <Crumb title='Logs' sub={meta} />
      <Card>
        <div className='pad'>
        <div className='logfilter'>
          {(['all', 'info', 'warn', 'error'] as const).map((value) => (
            <button
              key={value}
              type='button'
              className={level === value ? 'chip idle on' : 'chip idle'}
              aria-pressed={level === value}
              onClick={() => setLevel(value)}
            >
              {value}
            </button>
          ))}
          <input
            className='logneedle'
            aria-label='Filter messages'
            placeholder='filter messages…'
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
          />
        </div>
          {shown.length === 0 ? (
            <Placeholder>
              {logs.length === 0 ? '— the daemon has logged nothing yet —' : '— nothing matches —'}
            </Placeholder>
          ) : (
            <ol className='logrows' aria-label='Log entries'>
              {shown.map((entry, index) => (
                <li key={`${entry.at}-${index}`} className={`logrow ${entry.level}`}>
                  <span className='logat'>{clockOf(entry.at)}</span>
                  <span className='loglevel'>{entry.level}</span>
                  <span className='logmsg'>{entry.message}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Card>
    </>
  );
}
