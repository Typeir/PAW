/**
 * PAW Console Scrub Keys
 *
 * @fileoverview The left/right arrow scrub over plan members, bound at the
 * document so it works wherever focus sits — except inside a text field, where
 * the arrows belong to the caret, and except outside the Plan tab, where there
 * is nothing to scrub. It is a hook rather than a listener buried in a shell so
 * the binding is exercised by the same suite as the rest of the console.
 *
 * @module @paw/gui/application/hooks/useScrubKeys
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { useEffect } from 'react';

/**
 * Whether a keystroke landed in something that edits text.
 *
 * @param {EventTarget | null} target - The event target.
 * @returns {boolean} True when the target is a text field.
 */
function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;
}

/**
 * Bind arrow-key member scrubbing while the Plan tab is active.
 *
 * @param {boolean} enabled - Whether the Plan tab is showing.
 * @param {(delta: number) => void} step - The scrub action.
 */
export function useScrubKeys(enabled: boolean, step: (delta: number) => void): void {
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTextField(event.target)) {
        return;
      }
      if (event.key === 'ArrowLeft') {
        step(-1);
      } else if (event.key === 'ArrowRight') {
        step(1);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled, step]);
}
