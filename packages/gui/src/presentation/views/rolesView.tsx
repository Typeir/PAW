/**
 * Roles View
 *
 * @fileoverview The role bindings as the doctor reports them: what each declared
 * role is bound to, and whether that binding satisfies the role's requirements.
 * A required role that is unbound or bound to a model that cannot do the job is
 * blocking and shows as such; an optional role left unbound is merely optional,
 * and the two are never conflated.
 *
 * @module @paw/gui/presentation/views/rolesView
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { RoleDoctorRow } from '@paw/core';
import { Check as CheckIcon, Minus, X as XIcon } from 'lucide-react';
import { useConsoleData } from '../../application/hooks/useConsole.js';
import { Card } from '../atoms/card.js';
import { Crumb } from '../atoms/crumb.js';

/**
 * The verdict glyph for one role row.
 *
 * @param {RoleDoctorRow} row - The role row.
 * @returns {JSX.Element} The verdict.
 */
function Verdict({ row }: { readonly row: RoleDoctorRow }) {
  if (row.blocking) {
    return (
      <span className='ok crit'>
        <XIcon size={12} strokeWidth={2.5} aria-hidden='true' /> blocked
      </span>
    );
  }
  if (row.boundTo === null) {
    return (
      <span className='ok warn'>
        <Minus size={12} strokeWidth={2.5} aria-hidden='true' /> optional
      </span>
    );
  }
  return (
    <span className='ok'>
      <CheckIcon size={12} strokeWidth={2.5} aria-hidden='true' /> ok
    </span>
  );
}

/**
 * The Roles subsystem.
 *
 * @returns {JSX.Element} The view.
 */
export function RolesView() {
  const { doctor } = useConsoleData();
  return (
    <>
      <Crumb title='Roles' sub={`${doctor.roles.length} declared`} />
      <Card>
        <div className='pad'>
          <ul>
            {doctor.roles.map((row) => (
              <li className='role-row' key={row.role}>
                <span className='rid'>{row.role}</span>
                <span className='arr'>→</span>
                <span className='model'>{row.boundTo ?? '(unbound)'}</span>
                <Verdict row={row} />
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </>
  );
}
