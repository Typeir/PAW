/**
 * Plan Actions Tests
 *
 * @fileoverview Cover the create/delete plan controls: hidden on a static page,
 * create posts the trimmed name and closes on success, refusals display the
 * daemon's reason and keep the modal open, delete confirms against the selected
 * plan and clears the selection, and the delete verb no-ops when the selection
 * is gone by the time it fires.
 *
 * @module @paw/gui/test/unit/presentation/planActions
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  ConsoleProvider,
  useConsoleDispatch,
  useConsoleState,
} from '../../../src/application/context/consoleContext.js';
import { hydrate } from '../../../src/application/hydrateSnapshot.js';
import type { PlansClient, PlanWrite } from '../../../src/infrastructure/plansClient.js';
import { PlanActions } from '../../../src/presentation/views/swarm/planActions.js';
import { makeSnapshot, renderInConsole } from '../../fixtures.js';

const fakeClient = (over: Partial<PlansClient> = {}): PlansClient => ({
  create: vi.fn(async (): Promise<PlanWrite> => ({ ok: true, plan: 'plans/x.swarm.mjs' })),
  remove: vi.fn(async (): Promise<PlanWrite> => ({ ok: true, plan: 'plans/x.swarm.mjs' })),
  ...over,
});

const mount = (client: PlansClient, selectedPlan: string | null = 'plans/demo.swarm.mjs') =>
  render(
    <ConsoleProvider snapshot={makeSnapshot({ selectedPlan })} plans={client}>
      <PlanActions />
      <Probe />
    </ConsoleProvider>,
  );

/**
 * Shows the console's own plan selection; clicking refreshes the console with
 * a snapshot that no longer has a selected plan, as a daemon tick would.
 *
 * @returns {JSX.Element} The probe.
 */
function Probe() {
  const { plan } = useConsoleState();
  const dispatch = useConsoleDispatch();
  return (
    <button
      type='button'
      onClick={() => dispatch({ type: 'refresh', data: hydrate(makeSnapshot({ selectedPlan: null })) })}>
      selection:{plan ?? 'none'}
    </button>
  );
}

describe('PlanActions', () => {
  it('renders nothing on a static page', () => {
    renderInConsole(<PlanActions />);
    expect(screen.queryByRole('button', { name: 'new plan' })).toBeNull();
  });

  it('scaffolds a plan with the trimmed name and closes on success', async () => {
    const client = fakeClient();
    mount(client);
    await userEvent.click(screen.getByRole('button', { name: 'new plan' }));
    await userEvent.type(screen.getByLabelText('Plan name'), '  fresh-plan  ');
    await userEvent.click(screen.getByRole('button', { name: 'create' }));
    expect(client.create).toHaveBeenCalledWith('fresh-plan');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('creates on Enter, and not while a write is in flight', async () => {
    let settle: (result: PlanWrite) => void = () => undefined;
    const client = fakeClient({
      create: vi.fn(
        () =>
          new Promise<PlanWrite>((resolvePromise) => {
            settle = resolvePromise;
          }),
      ),
    });
    mount(client);
    await userEvent.click(screen.getByRole('button', { name: 'new plan' }));
    await userEvent.type(screen.getByLabelText('Plan name'), 'fresh{Enter}');
    expect(client.create).toHaveBeenCalledTimes(1);
    await userEvent.type(screen.getByLabelText('Plan name'), '{Enter}');
    expect(client.create).toHaveBeenCalledTimes(1);
    settle({ ok: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('does not create from an empty name', async () => {
    const client = fakeClient();
    mount(client);
    await userEvent.click(screen.getByRole('button', { name: 'new plan' }));
    expect(screen.getByRole('button', { name: 'create' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Plan name'), '{Enter}');
    expect(client.create).not.toHaveBeenCalled();
  });

  it('shows the daemon reason when a create is refused, and the modal stays', async () => {
    const client = fakeClient({
      create: vi.fn(async (): Promise<PlanWrite> => ({ ok: false, reason: 'plan already exists' })),
    });
    mount(client);
    await userEvent.click(screen.getByRole('button', { name: 'new plan' }));
    await userEvent.type(screen.getByLabelText('Plan name'), 'twice');
    await userEvent.click(screen.getByRole('button', { name: 'create' }));
    expect(await screen.findByText('plan already exists')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('cancel closes the create modal', async () => {
    mount(fakeClient());
    await userEvent.click(screen.getByRole('button', { name: 'new plan' }));
    await userEvent.click(screen.getByRole('button', { name: 'cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers delete only when a plan is selected', () => {
    mount(fakeClient(), null);
    expect(screen.getByRole('button', { name: 'new plan' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete plan' })).toBeNull();
  });

  it('renders delete as the shared red stoplight disc', () => {
    mount(fakeClient());
    expect(screen.getByRole('button', { name: 'Delete plan' })).toHaveClass('slight', 'close');
  });

  it('deletes the selected plan after confirm and clears the selection', async () => {
    const client = fakeClient();
    mount(client);
    await userEvent.click(screen.getByRole('button', { name: 'Delete plan' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('plans/demo.swarm.mjs');
    await userEvent.click(screen.getByRole('button', { name: 'delete' }));
    expect(client.remove).toHaveBeenCalledWith('plans/demo.swarm.mjs');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('selection:none')).toBeInTheDocument();
  });

  it('falls back to a plain refusal when a delete fails without a reason', async () => {
    const client = fakeClient({
      remove: vi.fn(async (): Promise<PlanWrite> => ({ ok: false })),
    });
    mount(client);
    await userEvent.click(screen.getByRole('button', { name: 'Delete plan' }));
    await userEvent.click(screen.getByRole('button', { name: 'delete' }));
    expect(await screen.findByText('refused')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('no-ops a delete confirm when the daemon dropped the selection meanwhile', async () => {
    const client = fakeClient();
    mount(client);
    await userEvent.click(screen.getByRole('button', { name: 'Delete plan' }));
    await userEvent.click(screen.getByText(/^selection:/));
    await userEvent.click(screen.getByRole('button', { name: 'delete' }));
    expect(client.remove).not.toHaveBeenCalled();
  });
});
