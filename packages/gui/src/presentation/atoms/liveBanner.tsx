/**
 * Live Banner Atom
 *
 * @fileoverview User-visible surface of the live-wire connection. Console renders
 * data of unknown age, so a daemon or console failure must not pass silently.
 * Every state where data might be stale say so, above view, in words that name
 * what to do.
 *
 * Three states worth distinguishing:
 * **degraded** mean socket down but console still poll, data few seconds old
 * and recover itself; **locked-out** mean daemon refuse this tab credential, no
 * amount of waiting fix it — operator must re-open URL terminal printed;
 * **connecting** be transient operator no act on. Spinner on locked-out would
 * never end, since that state does not resolve on its own.
 *
 * @module @paw/gui/presentation/atoms/liveBanner
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { useLiveStatus } from '../../application/context/consoleContext.js';

/**
 * Warning about a broken connection, or null when the connection is up.
 *
 * @returns {JSX.Element | null} Banner, or null.
 */
export function LiveBanner() {
  const { mode, message, retryNow } = useLiveStatus();

  if (mode === 'locked-out') {
    return (
      <p className='banner' role='alert'>
        <span className='lead'>credential refused</span>
        <span className='detail'>
          re-open the console from the URL <code>pawd</code> printed in your terminal
        </span>
      </p>
    );
  }

  if (mode === 'degraded') {
    return (
      <p className='banner' role='status'>
        <span className='lead'>live wire down — polling</span>
        {message === null ? null : <span className='detail'>{message}</span>}
        <button type='button' onClick={retryNow}>
          reconnect
        </button>
      </p>
    );
  }

  return null;
}
