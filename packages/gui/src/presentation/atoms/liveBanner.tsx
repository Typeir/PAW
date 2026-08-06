/**
 * Live Banner Atom
 *
 * @fileoverview The visible half of the live wire's failure path. When a poll of
 * `/api/state` fails, the console keeps rendering the last snapshot it had — and
 * says so, in red, above the view. Without this the page would look healthy
 * while showing data of unknown age, which is the silent failure the daemon and
 * the console are both written to avoid.
 *
 * @module @paw/gui/presentation/atoms/liveBanner
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { useLiveError } from '../../application/context/consoleContext.js';

/**
 * The stale-data warning, or nothing when the wire is healthy.
 *
 * @returns {JSX.Element | null} The banner, or null.
 */
export function LiveBanner() {
  const error = useLiveError();
  if (error === null) {
    return null;
  }
  return (
    <p className='banner' role='alert'>
      <span className='lead'>daemon unreachable</span>
      <span className='detail'>{error}</span>
      <span className='detail'>— showing the last snapshot received</span>
    </p>
  );
}
