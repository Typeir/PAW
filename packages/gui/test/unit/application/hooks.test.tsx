/**
 * Console Hook Tests
 *
 * @fileoverview Selector hooks, bound actions, theme, arrow scrub — the
 * application hooks layer. Exercise through small probes, no console, so a
 * failure here identifies the failing hook.
 *
 * @module @paw/gui/test/unit/application/hooks
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  useBrief,
  useConsoleData,
  useHasDraft,
  useMember,
  useMemberView,
  usePlan,
  useSection,
  useTab,
} from '../../../src/application/hooks/useConsole.js';
import { useConsoleActions } from '../../../src/application/hooks/useConsoleActions.js';
import { useScrubKeys } from '../../../src/application/hooks/useScrubKeys.js';
import { useTheme } from '../../../src/application/hooks/useTheme.js';
import { renderInConsole } from '../../fixtures.js';

/**
 * Probe over every selector hook.
 *
 * @returns {JSX.Element} The probe.
 */
function Selectors() {
  const data = useConsoleData();
  const plan = usePlan();
  const actions = useConsoleActions();
  return (
    <div>
      <span data-testid='host'>{data.host.hostname}</span>
      <span data-testid='plan'>{plan.name}</span>
      <span data-testid='section'>{useSection()}</span>
      <span data-testid='tab'>{useTab()}</span>
      <span data-testid='member'>{useMember()}</span>
      <span data-testid='draft'>{String(useHasDraft())}</span>
      <span data-testid='brief'>{useBrief()}</span>
      <span data-testid='view'>{useMemberView()?.key ?? 'none'}</span>
      <button type='button' onClick={() => actions.goto('gates')}>
        goto
      </button>
      <button type='button' onClick={() => actions.showTab('herd')}>
        tab
      </button>
      <button type='button' onClick={() => actions.select(2)}>
        select
      </button>
      <button type='button' onClick={() => actions.step(1)}>
        step
      </button>
      <button type='button' onClick={() => actions.edit('drafted')}>
        edit
      </button>
      <button type='button' onClick={actions.reset}>
        reset
      </button>
    </div>
  );
}

describe('selector hooks', () => {
  it('read the slice each panel needs', () => {
    renderInConsole(<Selectors />);
    expect(screen.getByTestId('host')).toHaveTextContent('LAPTOP-TEST');
    expect(screen.getByTestId('plan')).toHaveTextContent('demo');
    expect(screen.getByTestId('section')).toHaveTextContent('swarm');
    expect(screen.getByTestId('tab')).toHaveTextContent('plan');
    expect(screen.getByTestId('member')).toHaveTextContent('0');
    expect(screen.getByTestId('draft')).toHaveTextContent('false');
    expect(screen.getByTestId('brief')).toHaveTextContent('brief 1/4');
    expect(screen.getByTestId('view')).toHaveTextContent('alpha');
  });
});

describe('useConsoleActions', () => {
  it('binds every verb to the reducer', async () => {
    const user = userEvent.setup();
    renderInConsole(<Selectors />);

    await user.click(screen.getByRole('button', { name: 'goto' }));
    expect(screen.getByTestId('section')).toHaveTextContent('gates');

    await user.click(screen.getByRole('button', { name: 'tab' }));
    expect(screen.getByTestId('tab')).toHaveTextContent('herd');

    await user.click(screen.getByRole('button', { name: 'select' }));
    expect(screen.getByTestId('member')).toHaveTextContent('2');

    await user.click(screen.getByRole('button', { name: 'step' }));
    expect(screen.getByTestId('member')).toHaveTextContent('3');

    await user.click(screen.getByRole('button', { name: 'edit' }));
    expect(screen.getByTestId('brief')).toHaveTextContent('drafted');
    expect(screen.getByTestId('draft')).toHaveTextContent('true');

    await user.click(screen.getByRole('button', { name: 'reset' }));
    expect(screen.getByTestId('draft')).toHaveTextContent('false');
  });
});

/**
 * Probe over theme control.
 *
 * @returns {JSX.Element} The probe.
 */
function ThemeProbe() {
  const { theme, toggle } = useTheme();
  return (
    <button type='button' onClick={toggle}>
      {theme}
    </button>
  );
}

describe('useTheme', () => {
  it('starts dark and flips the document attribute both ways', async () => {
    const user = userEvent.setup();
    render(<ThemeProbe />);
    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('dark');

    await user.click(button);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(button).toHaveTextContent('light');

    await user.click(button);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(button).toHaveTextContent('dark');
  });

  it('adopts a theme the boot script already stamped', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    render(<ThemeProbe />);
    expect(screen.getByRole('button')).toHaveTextContent('light');
  });
});

/**
 * Props for {@link ScrubProbe}.
 *
 * @interface ScrubProbeProps
 * @property {boolean} enabled - Whether scrubbing is bound.
 * @property {(delta: number) => void} step - Receives scrub delta.
 */
interface ScrubProbeProps {
  readonly enabled: boolean;
  readonly step: (delta: number) => void;
}

/**
 * Probe over arrow-key scrub.
 *
 * @param {ScrubProbeProps} props - Probe props.
 * @returns {JSX.Element} The probe.
 */
function ScrubProbe({ enabled, step }: ScrubProbeProps) {
  useScrubKeys(enabled, step);
  return <textarea aria-label='brief' />;
}

describe('useScrubKeys', () => {
  it('scrubs on the arrow keys while the Plan tab is active', async () => {
    const step = vi.fn();
    render(<ScrubProbe enabled step={step} />);
    await userEvent.keyboard('{ArrowRight}{ArrowLeft}{ArrowUp}');
    expect(step.mock.calls).toEqual([[1], [-1]]);
  });

  it('leaves the arrows to the caret inside a text field', async () => {
    const step = vi.fn();
    render(<ScrubProbe enabled step={step} />);
    await userEvent.click(screen.getByLabelText('brief'));
    await userEvent.keyboard('{ArrowRight}');
    expect(step).not.toHaveBeenCalled();
  });

  it('binds nothing when the Plan tab is not showing', async () => {
    const step = vi.fn();
    render(<ScrubProbe enabled={false} step={step} />);
    await userEvent.keyboard('{ArrowRight}');
    expect(step).not.toHaveBeenCalled();
  });
});
