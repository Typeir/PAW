/**
 * Check Atom
 *
 * @fileoverview One entry in doctor bar. Tick or cross, check name, maybe value
 * check about. Green glyph indicates pass, red glyph fails; each is paired with
 * visually-hidden text so it is not purely decorative.
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
 * @property {string} label - Check name.
 * @property {boolean} ok - Whether check pass.
 * @property {string} [value] - Emphasised value check report.
 */
export interface CheckProps {
  readonly label: string;
  readonly ok: boolean;
  readonly value?: string;
}

/**
 * Doctor-bar check.
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
