/**
 * Overview View
 *
 * @fileoverview Console wired to `pawd` daemon. `pawd` read every figure
 * here from machine at last poll moment: daemon pid and parent, uptime and
 * resident memory, hostname, platform, CPU count and Node version, and process
 * subtree owned by PAW. Daemon narrows table to own descendants before serving
 * it. Console shows PAW workers, never the rest of the operator machine.
 *
 * @module @paw/gui/presentation/views/overviewView
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { Check as CheckIcon } from 'lucide-react';
import { useConsoleData } from '../../application/hooks/useConsole.js';
import { Card } from '../atoms/card.js';
import { Crumb } from '../atoms/crumb.js';
import { DataTable, type Column } from '../atoms/dataTable.js';
import { KeyValue } from '../atoms/keyValue.js';
import { Placeholder } from '../atoms/placeholder.js';
import { Stat } from '../atoms/stat.js';
import { ScopeCard } from './scopeCard.js';

const PROCESS_COLUMNS: readonly Column[] = [
  { key: 'pid', label: 'pid', right: true },
  { key: 'ppid', label: 'ppid', right: true },
  { key: 'name', label: 'process' },
];

/**
 * Format byte count as whole megabytes.
 *
 * @param {number} bytes - The byte count.
 * @returns {string} Label like `96 MB`.
 */
export function formatMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * Overview subsystem — host facts and PAW-owned processes.
 *
 * @returns {JSX.Element} The view.
 */
export function OverviewView() {
  const { host, processes, doctor, daemon, configPath, plans } = useConsoleData();
  const problems = doctor.config.length;
  return (
    <>
      <Crumb title='Overview' sub={`${host.hostname} · ${host.platform} ${host.release}`} />
      <ScopeCard />
      <dl>
        <Stat label='Uptime' value={daemon.uptimeLabel} />
        <Stat label='Resident' value={formatMb(host.rssBytes)} />
        <Stat label='Processes' value={String(processes.length)} />
        <Stat
          label='Doctor'
          value={doctor.ok ? 'ready' : 'blocked'}
          tone={doctor.ok ? 'ok' : 'crit'}
        />
      </dl>
      <Card title='Host' meta={daemon.live ? 'read from this machine' : 'no daemon attached'}>
        <div className='pad'>
          <KeyValue
            facts={[
              { label: 'pid', value: `${host.pid} (parent ${host.ppid})` },
              { label: 'uptime', value: `${host.uptimeSec}s` },
              { label: 'hostname', value: host.hostname },
              { label: 'platform', value: `${host.platform} ${host.release}` },
              { label: 'cpus', value: String(host.cpus) },
              { label: 'node', value: host.node },
              { label: 'cwd', value: host.cwd },
              { label: 'socket', value: daemon.socket },
              { label: 'config', value: configPath === '' ? '(none found)' : configPath },
              { label: 'plans', value: plans.length === 0 ? '(none found)' : plans.join(', ') },
            ]}
          />
        </div>
      </Card>
      <Card title='Config' meta={problems === 0 ? 'no problems' : `${problems} problems`}>
        {problems === 0 ? (
          <Placeholder>
            <CheckIcon size={13} strokeWidth={2.5} aria-hidden='true' /> config resolves
          </Placeholder>
        ) : (
          <div className='pad'>
            <KeyValue
              facts={doctor.config.map((problem) => ({
                label: problem.field,
                value: problem.message,
              }))}
            />
          </div>
        )}
      </Card>
      <Card title='Processes' meta={`${processes.length} owned by PAW`}>
        {processes.length === 0 ? (
          <Placeholder>— no processes reported —</Placeholder>
        ) : (
          <DataTable columns={PROCESS_COLUMNS}>
            {processes.map((proc) => (
              <tr key={proc.pid}>
                <td className='r idx'>{proc.pid}</td>
                <td className='r note'>{proc.ppid}</td>
                <td className='path'>{proc.name}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}
