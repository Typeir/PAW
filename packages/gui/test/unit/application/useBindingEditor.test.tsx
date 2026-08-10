/**
 * Binding Editor Hook Tests
 *
 * @fileoverview The Roles view's editing state through a small probe: no client
 * is not editable and does nothing; a client loads the models and reports a read
 * failure; a write clears any prior error, and a refusal surfaces its reason or a
 * default when it gives none.
 *
 * @module @paw/gui/test/unit/application/useBindingEditor
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useBindingEditor } from '../../../src/application/hooks/useBindingEditor.js';
import type { ConfigClient } from '../../../src/infrastructure/configClient.js';

/**
 * A probe over the hook, exposing its surface and two write buttons.
 *
 * @param {{ client: ConfigClient | null }} props - The client to drive.
 * @returns {JSX.Element} The probe.
 */
function Probe({ client }: { readonly client: ConfigClient | null }) {
  const editor = useBindingEditor(client);
  return (
    <div>
      <span data-testid='models'>{editor.models.join(',')}</span>
      <span data-testid='pending'>{String(editor.pending)}</span>
      <span data-testid='error'>{editor.error ?? ''}</span>
      <span data-testid='editable'>{String(editor.editable)}</span>
      <button onClick={() => editor.bind('edit.apply', 'fast')}>bind</button>
      <button onClick={() => editor.unbind('edit.apply')}>unbind</button>
    </div>
  );
}

const client = (over: Partial<ConfigClient> = {}): ConfigClient => ({
  models: async () => ['fast', 'slow'],
  bind: async () => ({ ok: true }),
  unbind: async () => ({ ok: true }),
  ...over,
});

describe('useBindingEditor', () => {
  it('is not editable and does nothing without a client', async () => {
    render(<Probe client={null} />);
    expect(screen.getByTestId('editable')).toHaveTextContent('false');
    expect(screen.getByTestId('models')).toHaveTextContent('');
    await userEvent.click(screen.getByText('bind'));
    await userEvent.click(screen.getByText('unbind'));
    expect(screen.getByTestId('error')).toHaveTextContent('');
  });

  it('loads the declared models when a client is present', async () => {
    render(<Probe client={client()} />);
    expect(await screen.findByText('fast,slow')).toBeInTheDocument();
    expect(screen.getByTestId('editable')).toHaveTextContent('true');
  });

  it('reports a models-read failure', async () => {
    render(
      <Probe
        client={client({
          models: async () => {
            throw new Error('offline');
          },
        })}
      />,
    );
    expect(await screen.findByText('could not read the declared models')).toBeInTheDocument();
  });

  it('binds and clears any prior error', async () => {
    const bind = vi.fn(async () => ({ ok: true }));
    render(<Probe client={client({ bind })} />);
    await userEvent.click(screen.getByText('bind'));
    expect(bind).toHaveBeenCalledWith('edit.apply', 'fast');
    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent('false'));
    expect(screen.getByTestId('error')).toHaveTextContent('');
  });

  it('surfaces the reason a write was refused', async () => {
    render(
      <Probe client={client({ bind: async () => ({ ok: false, reason: 'model "ghost" is not declared' }) })} />,
    );
    await userEvent.click(screen.getByText('bind'));
    expect(await screen.findByText('model "ghost" is not declared')).toBeInTheDocument();
  });

  it('falls back to a default reason when a refusal gives none', async () => {
    render(<Probe client={client({ unbind: async () => ({ ok: false }) })} />);
    await userEvent.click(screen.getByText('unbind'));
    expect(await screen.findByText('the edit was refused')).toBeInTheDocument();
  });
});
