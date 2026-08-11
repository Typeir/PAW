/**
 * Tooltip Position Calculation
 *
 * @fileoverview Compute absolute screen-space coords for tooltip against trigger, with viewport-aware flip and clamp. Port verbatim from Ikuisuus `ui/tooltip/calculatePosition` — pure function of two rects, unit-tested to 100% with fake `DOMRect`s. jsdom reports zero rects, but rectangular math still runs and clamps.
 *
 * @module @paw/gui/presentation/lib/calculatePosition
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

/**
 * Which side of trigger tooltip prefer.
 */
export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

/**
 * Compute fixed-position coords for tooltip, flip to opposite side when overflow viewport, clamp horizontal.
 *
 * @param {DOMRect} triggerRect - Trigger bounding rect.
 * @param {DOMRect} tooltipRect - Tooltip bounding rect.
 * @param {TooltipPlacement} placement - Preferred placement.
 * @param {number} [offset] - Gap between trigger and tooltip.
 * @returns {{ x: number; y: number; actualPlacement: TooltipPlacement }} Resolved position.
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
