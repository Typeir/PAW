/**
 * Violations View
 *
 * @fileoverview Lists enforcement results from the console store. With no
 * enforcement pawd answering for the repository, says so instead of reporting
 * none open. Severity comes
 * from violation itself: direct violation block in same file reads critical, one
 * with fix in another file (`indirectFix`) reads warning. Component renders store
 * rows in the order the store holds them.
 *
 * @module @paw/gui/presentation/views/violationsView
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { Check as CheckIcon } from 'lucide-react';
import { useConsoleData } from '../../application/hooks/useConsole.js';
import { Card } from '../atoms/card.js';
import { Crumb } from '../atoms/crumb.js';
import { Placeholder } from '../atoms/placeholder.js';

/**
 * Violations subsystem.
 *
 * @returns {JSX.Element} The view.
 */
export function ViolationsView() {
  const { violations, enforcementReachable } = useConsoleData();
  if (!enforcementReachable) {
    return (
      <>
        <Crumb title='Violations' sub='enforcement not running' />
        <Card>
          <Placeholder>
            no enforcement daemon answers for this repository · violations show once a hook starts it
          </Placeholder>
        </Card>
      </>
    );
  }
  if (violations.length === 0) {
    return (
      <>
        <Crumb title='Violations' sub='none open' />
        <Card>
          <Placeholder>
            <CheckIcon size={13} strokeWidth={2.5} aria-hidden='true' /> no open violations
          </Placeholder>
        </Card>
      </>
    );
  }
  return (
    <>
      <Crumb title='Violations' sub={`${violations.length} open`} />
      <Card>
        <div className='pad'>
          <ul>
            {violations.map((violation) => {
              const sev = violation.indirectFix ? 'warn' : 'crit';
              return (
                <li className='vrow' key={violation.id}>
                  <span className={`vstripe ${sev}`} />
                  <p className='vhead'>
                    <span className='file'>{violation.filePath}</span>
                    <span className={`sev ${sev}`}>{sev}</span>
                    <span className='rule'>{violation.rule}</span>
                  </p>
                  <p className='vmsg'>{violation.message}</p>
                </li>
              );
            })}
          </ul>
        </div>
      </Card>
    </>
  );
}
