/**
 * Tooltip Atom
 *
 * @fileoverview Hover/focus tooltip. Port from Ikuisuus `ui/tooltip`. Replace console browser `title=` attributes — no style, slow to appear, never fire on disabled control. Wrap trigger in listening span so hover over disabled button still surface why. Portal `role="tooltip"` element to body. Position by pure {@link calculatePosition}. Show and hide delay, timer-driven. Whole thing deterministic under fake timers. jsdom zero rects harmless — math just clamp.
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
 * @property {ReactNode} content - Tooltip content.
 * @property {TooltipPlacement} [placement] - Preferred side; default `top`.
 * @property {number} [showDelay] - Millisecond before show; default 200.
 * @property {number} [hideDelay] - Millisecond before hide; default 0.
 * @property {boolean} [disabled] - True render trigger with no tooltip at all.
 * @property {string} [className] - Extra class for wrapping span, so layout (e.g. `push`) survive wrap.
 * @property {ReactNode} children - Trigger.
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
 * Hover/focus tooltip around trigger.
 *
 * @param {TooltipProps} props - Tooltip props.
 * @returns {JSX.Element} Wrapped trigger.
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
