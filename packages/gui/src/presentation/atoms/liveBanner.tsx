/**
 * Live Banner Atom
 *
 * @fileoverview The visible half of the live wire's health. A console showing
 * data of unknown age while looking perfectly healthy is the silent failure the
 * daemon and the console are both written to avoid, so every state where the
 * data might be stale says so, above the view, in words that name what to do.
 *
 * Three of them are worth distinguishing rather than collapsing into "offline":
 * **degraded** means the socket is down but the console is still polling, so the
 * data is a few seconds old and recovering by itself; **locked-out** means the
 * daemon refused this tab's credential, which no amount of waiting fixes — the
 * operator has to re-open the URL the terminal printed; **connecting** is a
 * transient the operator does not need to act on. A spinner on the second of
 * those would be a lie the console tells forever.
 *
 * @module @paw/gui/presentation/atoms/liveBanner
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { useLiveStatus } from '../../application/context/consoleContext.js';

/**
 * The connection warning, or nothing when the wire is healthy.
 *
 * @returns {JSX.Element | null} The banner, or null.
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
