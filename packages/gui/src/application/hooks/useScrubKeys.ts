/**
 * PAW Console Scrub Keys
 *
 * @fileoverview Left/right arrow keyboards advance to previous or next plan
 * member. Listener bound at document; skips text fields so arrow keys move the
 * caret; active only while Plan tab showing. Implemented as hook so bindings
 * test under same suite as rest of console.
 *
 * @module @paw/gui/application/hooks/useScrubKeys
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { useEffect } from 'react';

/**
 * True when event target edits text.
 *
 * @param {EventTarget | null} target - The event target.
 * @returns {boolean} True when target is text field.
 */
function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;
}

/**
 * Bind arrow-key member scrub while Plan tab active.
 *
 * @param {boolean} enabled - Whether Plan tab is active.
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
