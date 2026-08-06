/**
 * Tooltip Atom
 *
 * @fileoverview A real tooltip, ported from Ikuisuus's `ui/tooltip` to replace the
 * console's browser `title=` attributes — which cannot be styled, are slow to
 * appear, and (the reason it matters here) never fire on a disabled control. It
 * wraps its trigger in a listening span so a hover over a disabled button still
 * surfaces the reason it is disabled, portals a `role="tooltip"` element to the
 * body, and positions it with the pure {@link calculatePosition}. Show and hide
 * are delayed and timer-driven, so the whole thing is deterministic under fake
 * timers; jsdom's zero rects are harmless because the math simply clamps.
 *
 * @module @paw/gui/presentation/atoms/tooltip
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { calculatePosition, type TooltipPlacement } from '../lib/calculatePosition.js';

/**
 * Props for {@link Tooltip}.
 *
 * @interface TooltipProps
 * @property {ReactNode} content - The tooltip content.
 * @property {TooltipPlacement} [placement] - Preferred side; defaults to `top`.
 * @property {number} [showDelay] - Milliseconds before showing; defaults to 200.
 * @property {number} [hideDelay] - Milliseconds before hiding; defaults to 0.
 * @property {boolean} [disabled] - When true, render the trigger with no tooltip at all.
 * @property {string} [className] - Extra class for the wrapping span, so layout (e.g. `push`) survives the wrap.
 * @property {ReactNode} children - The trigger.
 */
export interface TooltipProps {
  readonly content: ReactNode;
  readonly placement?: TooltipPlacement;
  readonly showDelay?: number;
  readonly hideDelay?: number;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * A hover/focus tooltip around a trigger.
 *
 * @param {TooltipProps} props - The tooltip props.
 * @returns {JSX.Element} The wrapped trigger.
 */
export function Tooltip({
  content,
  placement = 'top',
  showDelay = 200,
  hideDelay = 0,
  disabled = false,
  className,
  children,
}: TooltipProps) {
  const id = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    if (!visible) {
      return;
    }
    const pos = calculatePosition(
      triggerRef.current!.getBoundingClientRect(),
      tooltipRef.current!.getBoundingClientRect(),
      placement,
    );
    setCoords({ x: pos.x, y: pos.y });
  }, [visible, placement, content]);

  useEffect(
    () => () => {
      clearTimeout(showTimer.current);
      clearTimeout(hideTimer.current);
    },
    [],
  );

  if (disabled) {
    return <>{children}</>;
  }

  const show = (): void => {
    clearTimeout(hideTimer.current);
    showTimer.current = setTimeout(() => setVisible(true), showDelay);
  };
  const hide = (): void => {
    clearTimeout(showTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), hideDelay);
  };

  return (
    <span
      ref={triggerRef}
      className={className === undefined ? 'tt-wrap' : `tt-wrap ${className}`}
      aria-describedby={visible ? id : undefined}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}>
      {children}
      {visible &&
        createPortal(
          <div
            ref={tooltipRef}
            role='tooltip'
            id={id}
            className='tooltip'
            style={{ left: coords.x, top: coords.y }}>
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}
