/**
 * @fileoverview Cover Toast system: throw outside provider, fire each
 * type via shorthand (icon + message, with and without title), auto-
 * dismiss after per-type and custom durations, keep zero-duration toast
 * till dismissed, cap stack, dismiss via close button (timed and
 * sticky), hide button when not dismissible, dismiss all at once, and
 * honour position — so `toast.tsx` reach 100% with fake timers and no real
 * layout.
 *
 * @module @paw/gui/test/unit/presentation/toast
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast, type ToastPosition } from '../../../src/presentation/atoms/toast.js';

/**
 * A harness that fire toasts on demand.
 */
function Harness() {
  const t = useToast();
  return (
    <div>
      <button type='button' onClick={() => t.info('info msg')}>
        info
      </button>
      <button type='button' onClick={() => t.success('saved ok', { title: 'Saved' })}>
        success
      </button>
      <button type='button' onClick={() => t.warning('careful')}>
        warning
      </button>
      <button type='button' onClick={() => t.error('it broke', { dismissible: false })}>
        error
      </button>
      <button type='button' onClick={() => t.info('held open', { duration: 0 })}>
        sticky
      </button>
      <button type='button' onClick={() => t.info('quick', { duration: 1000 })}>
        custom
      </button>
      <button
        type='button'
        onClick={() => {
          for (let i = 0; i < 6; i += 1) {
            t.info(`burst ${i}`);
          }
        }}>
        burst
      </button>
      <button type='button' onClick={() => t.dismissAll()}>
        clear
      </button>
    </div>
  );
}

/**
 * Render harness inside provider.
 *
 * @param position - Toaster position.
 */
function setup(position?: ToastPosition) {
  return render(
    <ToastProvider position={position}>
      <Harness />
    </ToastProvider>,
  );
}

const advance = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe('useToast', () => {
  it('throws when used without a provider', () => {
    function Bare() {
      useToast();
      return null;
    }
    expect(() => render(<Bare />)).toThrow(/ToastProvider/);
  });
});

describe('ToastProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires each type with its message, and shows a title when given', () => {
    setup();
    fireEvent.click(screen.getByText('info'));
    fireEvent.click(screen.getByText('success'));
    expect(screen.getByText('info msg').closest('.toast')).toHaveClass('info');
    const saved = screen.getByText('saved ok').closest('.toast') as HTMLElement;
    expect(saved).toHaveClass('success');
    expect(saved.querySelector('.toast-title')).toHaveTextContent('Saved');
    expect(saved.querySelector('svg')).toBeInTheDocument();
    fireEvent.click(screen.getByText('warning'));
    fireEvent.click(screen.getByText('error'));
    expect(screen.getByText('careful').closest('.toast')).toHaveClass('warning');
    expect(screen.getByText('it broke').closest('.toast')).toHaveClass('error');
  });

  it('auto-dismisses after the type duration, then removes after the exit delay', () => {
    setup();
    fireEvent.click(screen.getByText('info'));
    expect(screen.getByText('info msg')).toBeInTheDocument();
    advance(5000);
    expect(screen.getByText('info msg').closest('.toast')).toHaveClass('exiting');
    advance(200);
    expect(screen.queryByText('info msg')).toBeNull();
  });

  it('honours a custom duration and keeps a zero-duration toast until dismissed', () => {
    setup();
    fireEvent.click(screen.getByText('custom'));
    advance(1000);
    advance(200);
    expect(screen.queryByText('quick')).toBeNull();

    fireEvent.click(screen.getByText('sticky'));
    advance(100000);
    expect(screen.getByText('held open')).toBeInTheDocument();
  });

  it('caps the stack, dropping the oldest', () => {
    setup();
    fireEvent.click(screen.getByText('burst'));
    expect(screen.queryByText('burst 0')).toBeNull();
    expect(screen.getByText('burst 5')).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(5);
  });

  it('dismisses one toast via its close button while leaving the others', () => {
    setup();
    fireEvent.click(screen.getByText('info'));
    fireEvent.click(screen.getByText('warning'));
    fireEvent.click(screen.getAllByLabelText('Dismiss')[0]);
    advance(200);
    expect(screen.queryByText('info msg')).toBeNull();
    expect(screen.getByText('careful')).toBeInTheDocument();
  });

  it('dismisses a sticky, untimed toast via its close button', () => {
    setup();
    fireEvent.click(screen.getByText('sticky'));
    fireEvent.click(screen.getByLabelText('Dismiss'));
    advance(200);
    expect(screen.queryByText('held open')).toBeNull();
  });

  it('omits the close button when a toast is not dismissible', () => {
    setup();
    fireEvent.click(screen.getByText('error'));
    expect(screen.getByText('it broke')).toBeInTheDocument();
    expect(screen.queryByLabelText('Dismiss')).toBeNull();
  });

  it('dismisses every toast at once', () => {
    setup();
    fireEvent.click(screen.getByText('info'));
    fireEvent.click(screen.getByText('warning'));
    fireEvent.click(screen.getByText('clear'));
    advance(200);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('places the toaster where asked', () => {
    setup('bottom-left');
    expect(document.querySelector('.toaster')).toHaveClass('bottom-left');
  });
});
