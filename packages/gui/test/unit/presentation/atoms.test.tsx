/**
 * Atom Tests
 *
 * @fileoverview The console's building blocks, each rendered in isolation with
 * every variant it offers — the header a card may or may not have, the tone a
 * stat may carry, the four member states, the dot-or-count rail item. The atoms
 * are where the instrument-panel look is defined, so this is where it is pinned.
 *
 * @module @paw/gui/test/unit/presentation/atoms
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScrollText, ShieldCheck, TriangleAlert, Workflow } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { Button } from '../../../src/presentation/atoms/button.js';
import { Card } from '../../../src/presentation/atoms/card.js';
import { Check } from '../../../src/presentation/atoms/check.js';
import { CodeBlock } from '../../../src/presentation/atoms/codeBlock.js';
import { Crumb } from '../../../src/presentation/atoms/crumb.js';
import { DataTable } from '../../../src/presentation/atoms/dataTable.js';
import { Figure } from '../../../src/presentation/atoms/figure.js';
import { GlobalStyles } from '../../../src/presentation/atoms/globalStyles.js';
import { KeyValue } from '../../../src/presentation/atoms/keyValue.js';
import { LiveBanner } from '../../../src/presentation/atoms/liveBanner.js';
import { Meter, pct } from '../../../src/presentation/atoms/meter.js';
import { NavItem } from '../../../src/presentation/atoms/navItem.js';
import { PawMark } from '../../../src/presentation/atoms/pawMark.js';
import { Placeholder } from '../../../src/presentation/atoms/placeholder.js';
import { Stat } from '../../../src/presentation/atoms/stat.js';
import { StateChip } from '../../../src/presentation/atoms/stateChip.js';
import { ConsoleProvider } from '../../../src/application/context/consoleContext.js';
import type { SocketLike } from '../../../src/infrastructure/liveSocket.js';
import { makeSnapshot, renderInConsole } from '../../fixtures.js';

/**
 * A socket that connects to nothing, for the banner states that never get one.
 */
const neverSocket: SocketLike = {
  send: () => undefined,
  close: () => undefined,
  listen: () => undefined,
};

describe('Card', () => {
  it('renders a header with a title and a meta note', () => {
    render(
      <Card title='Herd' meta='3 done'>
        body
      </Card>,
    );
    expect(screen.getByRole('heading', { name: 'Herd' })).toBeInTheDocument();
    expect(screen.getByText('3 done')).toHaveClass('meta');
  });

  it('renders a title with no meta note', () => {
    const { container } = render(<Card title='Herd'>body</Card>);
    expect(container.querySelector('.meta')).toBeNull();
  });

  it('renders headerless and with a variant', () => {
    const { container } = render(<Card variant='preview'>body</Card>);
    expect(container.querySelector('header')).toBeNull();
    expect(container.querySelector('section')).toHaveClass('card', 'preview');
  });
});

describe('Crumb', () => {
  it('renders a title and an optional subtitle', () => {
    const { container, rerender } = render(<Crumb title='Swarm' sub='/ demo.swarm.mjs' />);
    expect(screen.getByText('/ demo.swarm.mjs')).toHaveClass('sub');
    rerender(<Crumb title='Swarm' />);
    expect(container.querySelector('.sub')).toBeNull();
  });
});

describe('Stat', () => {
  it('tones a figure when asked and leaves it plain otherwise', () => {
    const { container, rerender } = render(<Stat label='Spend' value='$0.03' tone='ok' />);
    expect(container.querySelector('.val')).toHaveClass('ok');
    rerender(<Stat label='Members' value='4' />);
    expect(container.querySelector('.val')?.className).toBe('val');
  });
});

describe('StateChip', () => {
  it.each([
    ['done', 'done', 'done'],
    ['skipped', 'skip', 'idle'],
    ['running', 'run', 'run'],
    ['failed', 'fail', 'fail'],
  ] as const)('renders %s as "%s"', (state, label, cls) => {
    const { container } = render(<StateChip state={state} />);
    expect(container.querySelector('.chip')).toHaveClass(cls);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe('Check', () => {
  it('ticks a passing check and crosses a failing one', () => {
    const { container, rerender } = render(<Check label='count' ok value='4' />);
    expect(container.querySelector('.ok svg')).toBeInTheDocument();
    expect(container.querySelector('.vh')).toHaveTextContent('passed');
    expect(screen.getByText('4')).toBeInTheDocument();
    rerender(<Check label='count' ok={false} />);
    expect(container.querySelector('.bad svg')).toBeInTheDocument();
    expect(container.querySelector('.vh')).toHaveTextContent('failed');
    expect(container.querySelector('b')).toBeNull();
  });
});

describe('Button', () => {
  it('renders the primary treatment and an alignment class', () => {
    render(
      <Button primary align='push'>
        Capture
      </Button>,
    );
    expect(screen.getByRole('button')).toHaveClass('btn', 'pri', 'push');
  });

  it('disables a control and fires when enabled', async () => {
    const { rerender } = render(<Button disabled>Dry-run</Button>);
    const disabled = screen.getByRole('button');
    expect(disabled).toBeDisabled();
    expect(disabled).not.toHaveAttribute('title');

    let clicks = 0;
    rerender(<Button onClick={() => (clicks += 1)}>Go</Button>);
    await userEvent.click(screen.getByRole('button'));
    expect(clicks).toBe(1);
  });
});

describe('Meter', () => {
  it('sizes segments as a share of the total', () => {
    const { container } = render(
      <Meter
        total={4}
        segments={[
          { name: 'done', value: 1, colorVar: '--good' },
          { name: 'failed', value: 3, colorVar: '--crit' },
        ]}
      />,
    );
    const bars = container.querySelectorAll('.mini i');
    expect(bars[0]).toHaveStyle({ width: '25.00%' });
    expect(bars[1]).toHaveStyle({ width: '75.00%' });
  });

  it('collapses to zero width when there is nothing to divide', () => {
    expect(pct(3, 0)).toBe(0);
  });
});

describe('DataTable', () => {
  it('right-aligns the columns that ask for it', () => {
    const { container } = render(
      <DataTable
        columns={[
          { key: 'pid', label: 'pid', right: true },
          { key: 'name', label: 'process' },
        ]}>
        <tr>
          <td>1</td>
          <td>init</td>
        </tr>
      </DataTable>,
    );
    const heads = container.querySelectorAll('th');
    expect(heads[0]).toHaveClass('r');
    expect(heads[1].className).toBe('');
  });
});

describe('KeyValue', () => {
  it('lists labelled facts', () => {
    render(<KeyValue facts={[{ label: 'node', value: 'v22.23.1' }]} />);
    expect(screen.getByText('node')).toBeInTheDocument();
    expect(screen.getByText('v22.23.1')).toBeInTheDocument();
  });
});

describe('CodeBlock', () => {
  it('renders highlighted rows with the accented line', () => {
    const { container } = render(
      <CodeBlock source={"const x = 1;\nconst y = 2;"} highlightLine={2} label='Swarm plan source' />,
    );
    expect(container.querySelectorAll('.row')).toHaveLength(2);
    expect(container.querySelector('.row.hl')).toHaveTextContent('const y = 2;');
    expect(container.querySelector('pre')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Swarm plan source' })).toBeInTheDocument();
  });
});

describe('Placeholder, PawMark, Figure, GlobalStyles', () => {
  it('renders an empty state', () => {
    render(<Placeholder>nothing here</Placeholder>);
    expect(screen.getByText('nothing here')).toHaveClass('placeholder');
  });

  it('renders the wordmark glyph as decoration', () => {
    const { container } = render(<PawMark />);
    expect(container.querySelector('.mark')).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders a figure and its cost variant', () => {
    const { container, rerender } = render(<Figure value='41280' caption='tokens in' />);
    expect(container.querySelector('figure')?.className).toBe('');
    expect(screen.getByText('tokens in').tagName).toBe('FIGCAPTION');
    rerender(<Figure value='$0.03' caption='spend' cost />);
    expect(container.querySelector('figure')).toHaveClass('cost');
  });

  it('mounts the stylesheet from inside the tree', () => {
    const { container } = render(<GlobalStyles />);
    const style = container.querySelector('style');
    expect(style?.textContent).toContain('--accent');
  });
});

describe('NavItem', () => {
  it('marks the active subsystem and navigates on click', async () => {
    renderInConsole(
      <>
        <NavItem id='swarm' icon={Workflow} label='Swarm' dot />
        <NavItem id='violations' icon={TriangleAlert} label='Violations' count={2} crit />
        <NavItem id='gates' icon={ShieldCheck} label='Gates' count={11} />
        <NavItem id='logs' icon={ScrollText} label='Logs' />
      </>,
    );
    const swarm = screen.getByRole('button', { name: /Swarm/ });
    expect(swarm).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /Violations/ }).querySelector('.n')).toHaveClass('crit');
    expect(screen.getByRole('button', { name: /Gates/ }).querySelector('.n')?.className).toBe('n');
    expect(screen.getByRole('button', { name: /Logs/ }).querySelector('.n')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /Roles|Gates/ }));
    expect(screen.getByRole('button', { name: /Gates/ })).toHaveAttribute('aria-current', 'page');
    expect(swarm).not.toHaveAttribute('aria-current');
  });
});

describe('LiveBanner', () => {
  it('says nothing while the wire is healthy', () => {
    const { container } = renderInConsole(<LiveBanner />);
    expect(container.querySelector('.banner')).toBeNull();
  });

  it('says the wire is down, and offers to reconnect, while polling', () => {
    // A daemon behind the page but no socket: degraded, and the console says so
    // rather than looking healthy while showing data of unknown age.
    render(
      <ConsoleProvider snapshot={makeSnapshot()} source={async () => makeSnapshot()}>
        <LiveBanner />
      </ConsoleProvider>,
    );

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('live wire down — polling');
    expect(screen.getByRole('button', { name: 'reconnect' })).toBeInTheDocument();
  });

  it('names the dead end when the daemon refused the credential', () => {
    // No token to present: polling would be refused too, so the banner tells the
    // operator the one thing that fixes it instead of spinning.
    render(
      <ConsoleProvider snapshot={makeSnapshot()} connect={() => neverSocket} token={null}>
        <LiveBanner />
      </ConsoleProvider>,
    );

    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('credential refused');
    expect(banner).toHaveTextContent('re-open the console from the URL');
  });
});
