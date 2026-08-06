/**
 * Tooltip Position Calculation
 *
 * @fileoverview Computes absolute screen-space coordinates for a tooltip relative
 * to its trigger, with viewport-aware flip and clamp. Ported verbatim from
 * Ikuisuus's `ui/tooltip/calculatePosition` — a pure function of two rects, so it
 * is unit-tested to 100% with fabricated `DOMRect`s and needs no real layout (jsdom
 * reports zero rects, which is fine: the math still runs and clamps).
 *
 * @module @paw/gui/presentation/lib/calculatePosition
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Which side of the trigger a tooltip prefers.
 */
export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

/**
 * Compute the fixed-position coordinates for a tooltip, flipping to the opposite
 * side when it would overflow the viewport and clamping horizontally.
 *
 * @param {DOMRect} triggerRect - The trigger's bounding rect.
 * @param {DOMRect} tooltipRect - The tooltip's bounding rect.
 * @param {TooltipPlacement} placement - The preferred placement.
 * @param {number} [offset] - Gap between trigger and tooltip.
 * @returns {{ x: number; y: number; actualPlacement: TooltipPlacement }} The resolved position.
 */
export function calculatePosition(
  triggerRect: DOMRect,
  tooltipRect: DOMRect,
  placement: TooltipPlacement,
  offset = 8,
): { x: number; y: number; actualPlacement: TooltipPlacement } {
  const { innerWidth, innerHeight } = window;

  let x = 0;
  let y = 0;
  let actualPlacement = placement;

  switch (placement) {
    case 'top':
      x = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
      y = triggerRect.top - tooltipRect.height - offset;
      break;
    case 'bottom':
      x = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
      y = triggerRect.bottom + offset;
      break;
    case 'left':
      x = triggerRect.left - tooltipRect.width - offset;
      y = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2;
      break;
    case 'right':
      x = triggerRect.right + offset;
      y = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2;
      break;
  }

  const viewportMargin = 8;

  if (placement === 'top' && y < viewportMargin) {
    y = triggerRect.bottom + offset;
    actualPlacement = 'bottom';
  } else if (placement === 'bottom' && y + tooltipRect.height > innerHeight - viewportMargin) {
    y = triggerRect.top - tooltipRect.height - offset;
    actualPlacement = 'top';
  } else if (placement === 'left' && x < viewportMargin) {
    x = triggerRect.right + offset;
    actualPlacement = 'right';
  } else if (placement === 'right' && x + tooltipRect.width > innerWidth - viewportMargin) {
    x = triggerRect.left - tooltipRect.width - offset;
    actualPlacement = 'left';
  }

  x = Math.max(viewportMargin, Math.min(x, innerWidth - tooltipRect.width - viewportMargin));

  return { x, y, actualPlacement };
}
