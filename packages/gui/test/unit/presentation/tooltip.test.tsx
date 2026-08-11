/**
 * @fileoverview Test Tooltip atom. Render only trigger when disabled. Show on
 * hover after delay (portalled `role="tooltip"`, wired via `aria-describedby`).
 * Hide on leave. Show on focus. Forward extra className to wrapper. Give
 * `tooltip.tsx` 100% with fake timers and no real layout.
 *
 * @module @paw/gui/test/unit/presentation/tooltip
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tooltip } from '../../../src/presentation/atoms/tooltip.js';

describe('Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders only the trigger when disabled', () => {
    const { container } = render(
      <Tooltip content='hint' disabled>
        <button type='button'>go</button>
      </Tooltip>,
    );
    expect(container.querySelector('.tt-wrap')).toBeNull();
    expect(screen.getByRole('button', { name: 'go' })).toBeInTheDocument();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows on hover after the delay and describes the trigger', () => {
    const { container } = render(
      <Tooltip content='needs daemon'>
        <button type='button'>go</button>
      </Tooltip>,
    );
    const wrap = container.querySelector('.tt-wrap') as HTMLElement;
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.mouseEnter(wrap);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('needs daemon');
    expect(wrap).toHaveAttribute('aria-describedby', tip.id);
  });

  it('hides on mouse leave', () => {
    const { container } = render(
      <Tooltip content='x'>
        <button type='button'>go</button>
      </Tooltip>,
    );
    const wrap = container.querySelector('.tt-wrap') as HTMLElement;
    fireEvent.mouseEnter(wrap);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.mouseLeave(wrap);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows on focus and forwards an extra className to the wrapper', () => {
    const { container } = render(
      <Tooltip content='x' className='push' showDelay={0}>
        <button type='button'>go</button>
      </Tooltip>,
    );
    const wrap = container.querySelector('.tt-wrap') as HTMLElement;
    expect(wrap).toHaveClass('push');
    fireEvent.focus(wrap);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });
});
