/**
 * Roles View
 *
 * @fileoverview Render role bindings as doctor reports them: what each declared
 * role binds to, and whether the binding meets the role's requirements. A
 * required role that is unbound, or bound to a model lacking the role's
 * capability, blocks the view. Optional role left unbound renders optional.
 *
 * @module @paw/gui/presentation/views/rolesView
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { RoleDoctorRow } from '@paw/core';
import { Check as CheckIcon, Minus, X as XIcon } from 'lucide-react';
import { useConsoleData } from '../../application/hooks/useConsole.js';
import { useConfigClient } from '../../application/context/consoleContext.js';
import { useBindingEditor } from '../../application/hooks/useBindingEditor.js';
import { Card } from '../atoms/card.js';
import { Crumb } from '../atoms/crumb.js';
import { Select } from '../atoms/select.js';

/**
 * Value the "(unbound)" option carry in model select.
 */
const UNBOUND = '';

/**
 * Verdict glyph for one role row.
 *
 * @param {RoleDoctorRow} row - Role row.
 * @returns {JSX.Element} Verdict.
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
 * Roles subsystem.
 *
 * @returns {JSX.Element} The view.
 */
export function RolesView() {
  const { doctor } = useConsoleData();
  const editor = useBindingEditor(useConfigClient());
  const options = [
    { value: UNBOUND, label: '(unbound)' },
    ...editor.models.map((model) => ({ value: model, label: model })),
  ];
  return (
    <>
      <Crumb title='Roles' sub={`${doctor.roles.length} declared`} />
      <Card>
        <div className='pad'>
          {editor.error !== null && <p className='ok crit'>{editor.error}</p>}
          <ul>
            {doctor.roles.map((row) => (
              <li className='role-row' key={row.role}>
                <span className='rid'>{row.role}</span>
                <span className='arr'>→</span>
                {editor.editable ? (
                  <Select
                    value={row.boundTo ?? UNBOUND}
                    options={options}
                    disabled={editor.pending}
                    ariaLabel={`Model for ${row.role}`}
                    onChange={(value) =>
                      value === UNBOUND ? editor.unbind(row.role) : editor.bind(row.role, value)
                    }
                  />
                ) : (
                  <span className='model'>{row.boundTo ?? '(unbound)'}</span>
                )}
                <Verdict row={row} />
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </>
  );
}
