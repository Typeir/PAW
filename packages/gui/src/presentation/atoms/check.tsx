/**
 * Check Atom
 *
 * @fileoverview One entry in the doctor bar: a tick or a cross, the check's
 * name, and optionally the value the check is about. Green means the plan's own
 * doctor said so — the glyph is never decoration.
 *
 * @module @paw/gui/presentation/atoms/check
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { Check as CheckIcon, X as XIcon } from 'lucide-react';

/**
 * Props for {@link Check}.
 *
 * @interface CheckProps
 * @property {string} label - The check name.
 * @property {boolean} ok - Whether the check passes.
 * @property {string} [value] - The emphasised value the check reports.
 */
export interface CheckProps {
  readonly label: string;
  readonly ok: boolean;
  readonly value?: string;
}

/**
 * A doctor-bar check.
 *
 * @param {CheckProps} props - The check props.
 * @returns {JSX.Element} The check.
 */
export function Check({ label, ok, value }: CheckProps) {
  return (
    <li className='chk'>
      <span className={ok ? 'ok' : 'bad'} aria-hidden='true'>
        {ok ? <CheckIcon size={13} strokeWidth={2.5} /> : <XIcon size={13} strokeWidth={2.5} />}
      </span>
      <span className='vh'>{ok ? 'passed' : 'failed'}</span> {label}
      {value !== undefined && <b>{value}</b>}
    </li>
  );
}
