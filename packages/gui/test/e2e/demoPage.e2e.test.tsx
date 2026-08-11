/**
 * Demo page E2E.
 *
 * @fileoverview Inject self-contained snapshot, render through console. Tests
 * verify what the build itself cannot. Demo must satisfy the same
 * {@link PawSnapshot} contract the daemon serves. Throw when member count and
 * pre-rendered briefs mismatch at hydration. Static page renders idle daemon
 * and no host to report.
 *
 * @module @paw/gui/test/e2e/demoPage.e2e
 */

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { demoSnapshot } from '../../demo/spellLore.mjs';
import { renderConsole } from '../fixtures.js';

const snapshot = demoSnapshot();

describe('the demo page', () => {
  it('ships a snapshot the console can hydrate', () => {
    expect(snapshot.briefs).toHaveLength(snapshot.memberTotal);
    expect(snapshot.slugs).toHaveLength(snapshot.memberTotal);
    renderConsole(snapshot);
    expect(
      screen.getByRole('heading', { name: 'plans/spell-lore.swarm.mjs' }),
    ).toBeInTheDocument();
    expect(screen.getByText('member 1 / 393')).toBeInTheDocument();
    expect(screen.getByLabelText('Member brief')).toHaveValue(snapshot.briefs[0]);
  });

  it('scrubs to a member whose brief took a different branch of the plan', async () => {
    renderConsole(snapshot);
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(screen.getByText('member 3 / 393')).toBeInTheDocument();
    expect(screen.getByLabelText('Member brief')).toHaveValue(snapshot.briefs[2]);
  });

  it('says it has no daemon behind it rather than faking one', async () => {
    renderConsole(snapshot);
    expect(screen.getByText(/pawd idle/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Overview/ }));
    expect(screen.getByText('no daemon attached')).toBeInTheDocument();
    expect(screen.getByText('— no processes reported —')).toBeInTheDocument();
  });
});
