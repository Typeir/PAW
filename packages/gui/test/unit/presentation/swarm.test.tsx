/**
 * Swarm View Tests
 *
 * @fileoverview Tests each Swarm view panel in isolation. Stat strip and run
 * bar reflect the current run. Plan source renders beside the member brief.
 * Doctor bar reads core's own plan findings. Herd covers a full run, an empty
 * run, and selecting a failed member.
 *
 * @module @paw/gui/test/unit/presentation/swarm
 */

import { encodeEnvelope, parseClientMessage } from '@paw/core';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ConsoleProvider } from '../../../src/application/context/consoleContext.js';
import type { SocketHandlers, SocketLike } from '../../../src/infrastructure/liveSocket.js';
import { CodeCard } from '../../../src/presentation/views/swarm/codeCard.js';
import { CommandBar, releaseBlocker } from '../../../src/presentation/views/swarm/commandBar.js';
import { DoctorBar } from '../../../src/presentation/views/swarm/doctorBar.js';
import { HerdTab } from '../../../src/presentation/views/swarm/herdTab.js';
import { PreviewCard } from '../../../src/presentation/views/swarm/previewCard.js';
import { RunBar } from '../../../src/presentation/views/swarm/runBar.js';
import { StatStrip } from '../../../src/presentation/views/swarm/statStrip.js';
import { SwarmTabs } from '../../../src/presentation/views/swarm/swarmTabs.js';
import { SwarmView } from '../../../src/presentation/views/swarm/swarmView.js';
import { useConsoleActions } from '../../../src/application/hooks/useConsoleActions.js';
import { makeSnapshot, renderInConsole } from '../../fixtures.js';

/**
 * Seed the console context selection from inside the provider.
 *
 * @param {{ paths: string[] }} props - Paths to toggle on.
 * @returns {JSX.Element} A seed button.
 */
function SeedContext({ paths }: { paths: string[] }) {
  const { toggleContext } = useConsoleActions();
  return (
    <button type='button' onClick={() => toggleContext(paths)}>
      seed
    </button>
  );
}

describe('StatStrip', () => {
  it('counts members, dispatches, confirmations, and spend', () => {
    const { container } = renderInConsole(<StatStrip />);
    const values = [...container.querySelectorAll('.stat .val')].map((el) => el.textContent);
    expect(values).toEqual(['4', '3 / 1 skipped', '1', '$0.03']);
  });
});

describe('RunBar', () => {
  it('splits the run across the plan and names the counts', () => {
    const { container } = renderInConsole(<RunBar />);
    expect(screen.getByLabelText('Active run')).toBeInTheDocument();
    expect(container.querySelector('[data-seg="skipped"]')).toHaveStyle({ width: '25.00%' });
    expect(container.querySelector('[data-seg="failed"]')).toBeInTheDocument();
    expect(screen.getByText('15-40-02')).toBeInTheDocument();
  });
});

describe('SwarmTabs', () => {
  it('marks the active tab and badges the herd', async () => {
    renderInConsole(<SwarmTabs />);
    expect(screen.getByRole('tab', { name: /Plan/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('1/3')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Herd/ }));
    expect(screen.getByRole('tab', { name: /Herd/ })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('CodeCard', () => {
  it('names the plan file and shows its source', () => {
    renderInConsole(<CodeCard />);
    expect(screen.getByRole('heading', { name: 'plans/demo.swarm.mjs' })).toBeInTheDocument();
    expect(screen.getByText('role lore.author · 4 members')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Swarm plan source' })).toBeInTheDocument();
  });
});

describe('CodeCard without a selection', () => {
  it('falls back to the plan’s own name', () => {
    renderInConsole(<CodeCard />, makeSnapshot({ selectedPlan: null }));
    expect(screen.getByRole('heading', { name: 'demo.swarm.mjs' })).toBeInTheDocument();
  });
});

describe('PreviewCard', () => {
  it('shows the rendered brief, its slug, and the member level', () => {
    renderInConsole(<PreviewCard />);
    expect(screen.getByLabelText('Member brief')).toHaveValue('brief 1/4: alpha <&>"\'');
    expect(screen.getByText('alpha · lvl 2')).toBeInTheDocument();
    expect(screen.getByText('member 1 / 4')).toBeInTheDocument();
  });

  it('scrubs with the arrows and drops the level when the run reports none', async () => {
    renderInConsole(<PreviewCard />);
    await userEvent.click(screen.getByRole('button', { name: 'Next member' }));
    expect(screen.getByText('member 2 / 4')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Previous member' }));
    expect(screen.getByText('member 1 / 4')).toBeInTheDocument();
  });

  it('omits the level when the run has not dispatched the member', () => {
    renderInConsole(
      <PreviewCard />,
      makeSnapshot({ run: { ...makeSnapshot().run, members: [] } }),
    );
    expect(screen.getByText('alpha')).toBeInTheDocument();
  });

  it('holds an edit and offers a reset that restores the rendered brief', async () => {
    const user = userEvent.setup();
    renderInConsole(<PreviewCard />);
    const editor = screen.getByLabelText('Member brief');
    await user.clear(editor);
    await user.type(editor, 'my own brief');
    expect(editor).toHaveValue('my own brief');

    await user.click(screen.getByRole('button', { name: 'reset' }));
    expect(editor).toHaveValue('brief 1/4: alpha <&>"\'');
    expect(screen.queryByRole('button', { name: 'reset' })).toBeNull();
  });

  it('drops the draft when the operator scrubs to another member', async () => {
    const user = userEvent.setup();
    renderInConsole(<PreviewCard />);
    await user.type(screen.getByLabelText('Member brief'), '!');
    await user.click(screen.getByRole('button', { name: 'Next member' }));
    expect(screen.getByLabelText('Member brief')).toHaveValue('brief 2/4: beta');
  });
});

describe('DoctorBar', () => {
  it("reports core's own plan findings and the role binding", () => {
    const { container } = renderInConsole(<DoctorBar />);
    const checks = [...container.querySelectorAll('.chk')].map((el) => el.textContent);
    expect(checks[0]).toContain('count');
    expect(checks[0]).toContain('4');
    expect(container.querySelectorAll('.bad')).toHaveLength(1);
    expect(screen.getByText('lore.author')).toBeInTheDocument();
  });

  it('leaves the run controls disabled until a daemon can drive them', () => {
    renderInConsole(<DoctorBar />);
    expect(screen.getByRole('button', { name: /Dry-run/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Capture/ })).toBeDisabled();
    // Tooltip wrapper carry reason, not browser title
    expect(screen.getByRole('button', { name: /Capture/ })).not.toHaveAttribute('title');
  });
});

describe('releaseBlocker', () => {
  it('names each blocker and clears when live with a plan', () => {
    expect(releaseBlocker(false, 'plans/x.swarm.mjs')).toBe('release needs a live connection');
    expect(releaseBlocker(true, null)).toBe('pick a plan to release');
    expect(releaseBlocker(true, 'plans/x.swarm.mjs')).toBeNull();
  });
});

describe('CommandBar', () => {
  it('hints the scrub keys and disables release until the console is live', () => {
    renderInConsole(<CommandBar />);
    expect(screen.getByText(/scrub member/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Release herd/ })).toBeDisabled();
  });

  it('sends a release frame carrying the live toggle over an authenticated socket', async () => {
    const sent: string[] = [];
    let handlers: SocketHandlers | null = null;
    const socket: SocketLike = {
      send: (text: string) => sent.push(text),
      close: () => undefined,
      listen: (registered) => {
        handlers = registered;
      },
    };
    render(
      <ConsoleProvider snapshot={makeSnapshot()} connect={() => socket} token='cred'>
        <CommandBar />
      </ConsoleProvider>,
    );
    act(() => handlers?.open());
    act(() => handlers?.message(encodeEnvelope('hello', makeSnapshot(), 1)));

    await userEvent.click(screen.getByRole('checkbox', { name: /live model/ }));
    await userEvent.click(screen.getByRole('button', { name: /Release herd/ }));

    const frame = parseClientMessage(sent[sent.length - 1]);
    expect(frame).toEqual({
      v: 1,
      type: 'release',
      settings: { plan: 'plans/demo.swarm.mjs', live: true },
    });
    expect(screen.getByRole('status')).toHaveTextContent('approve it in the pawd terminal');
  });

  it('carries the attached-context selection inside the release settings', async () => {
    const sent: string[] = [];
    let handlers: SocketHandlers | null = null;
    const socket: SocketLike = {
      send: (text: string) => sent.push(text),
      close: () => undefined,
      listen: (registered) => {
        handlers = registered;
      },
    };
    render(
      <ConsoleProvider snapshot={makeSnapshot()} connect={() => socket} token='cred'>
        <SeedContext paths={['docs/one.mdx']} />
        <CommandBar />
      </ConsoleProvider>,
    );
    act(() => handlers?.open());
    act(() => handlers?.message(encodeEnvelope('hello', makeSnapshot(), 1)));

    await userEvent.click(screen.getByRole('button', { name: 'seed' }));
    await userEvent.click(screen.getByRole('button', { name: /Release herd · 1 ctx/ }));

    const frame = parseClientMessage(sent[sent.length - 1]);
    expect(frame).toEqual({
      v: 1,
      type: 'release',
      settings: { plan: 'plans/demo.swarm.mjs', live: false, context: ['docs/one.mdx'] },
    });
  });
});

describe('HerdTab', () => {
  it('lists every dispatched member with its state and level', () => {
    renderInConsole(<HerdTab />);
    const tables = screen.getAllByRole('table');
    const buttons = tables.flatMap((t) => within(t).queryAllByRole('button'));
    expect(buttons).toHaveLength(4);
    expect(screen.getByText('lvl 9')).toBeInTheDocument();
    expect(screen.getByText('1 done · 1 run · 1 fail')).toBeInTheDocument();
  });

  it('groups members with what needs attention first and settled last', () => {
    renderInConsole(<HerdTab />);
    const groups = screen
      .getAllByRole('region')
      .map((g) => g.getAttribute('aria-label') ?? '');
    expect(groups).toEqual([
      'In progress, 1 member(s)',
      'Failed, 1 member(s)',
      'Settled, 2 member(s)',
    ]);
  });

  it('renders no table for a group with nothing in it', () => {
    const base = makeSnapshot();
    renderInConsole(
      <HerdTab />,
      makeSnapshot({
        run: {
          ...base.run,
          members: base.run.members.filter((m) => m.state === 'done'),
        },
      }),
    );
    const groups = screen
      .getAllByRole('region')
      .map((g) => g.getAttribute('aria-label') ?? '');
    expect(groups).toEqual(['Settled, 1 member(s)']);
    expect(screen.queryByText('Failed')).not.toBeInTheDocument();
    expect(screen.queryByText('In progress')).not.toBeInTheDocument();
  });

  it('shows the run spend', () => {
    renderInConsole(<HerdTab />);
    expect(screen.getByText('41280')).toBeInTheDocument();
    expect(screen.getByText('9130')).toBeInTheDocument();
    expect(screen.getByText('$0.03')).toBeInTheDocument();
  });

  it('says so before anything has been dispatched', () => {
    renderInConsole(<HerdTab />, makeSnapshot({ run: { ...makeSnapshot().run, members: [] } }));
    expect(
      screen.getByText('— no run released through this console · release with --run or swarm run --ui —'),
    ).toBeInTheDocument();
  });

  it('selects a member by click, by Enter, and by Space', async () => {
    const user = userEvent.setup();
    renderInConsole(
      <>
        <HerdTab />
        <PreviewCard />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Select member 3, delta' }));
    expect(screen.getByText('member 4 / 4')).toBeInTheDocument();

    screen.getByRole('button', { name: 'Select member 1, beta' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('member 2 / 4')).toBeInTheDocument();

    screen.getByRole('button', { name: 'Select member 2, gamma' }).focus();
    await user.keyboard(' ');
    expect(screen.getByText('member 3 / 4')).toBeInTheDocument();

    screen.getByRole('button', { name: 'Select member 0, alpha' }).focus();
    await user.keyboard('{Escape}');
    expect(screen.getByText('member 3 / 4')).toBeInTheDocument();
  });
});

describe('SwarmView', () => {
  it('shows the plan tab by default and switches to herd and logs', async () => {
    const user = userEvent.setup();
    renderInConsole(<SwarmView />);
    expect(screen.getByRole('heading', { name: 'Swarm', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('run 2026-08-05T15-40-02')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Swarm plan' })).toHaveTextContent(
      'plans/demo.swarm.mjs',
    );
    expect(screen.getByRole('heading', { name: 'plans/demo.swarm.mjs' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Herd/ }));
    expect(screen.getByRole('heading', { name: 'Herd' })).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'tab-herd');

    await user.click(screen.getByRole('tab', { name: 'Logs' }));
    expect(screen.getByText('— live log stream — a pawd control API will back this —')).toBeInTheDocument();
  });
});
