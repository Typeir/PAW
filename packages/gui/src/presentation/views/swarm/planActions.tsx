/**
 * Plan Actions
 *
 * @fileoverview Create and delete plan files from the console. Renders next to
 * the plan picker: `new` scaffolds `plans/<name>.swarm.mjs` from the daemon's
 * starter template, `delete` removes the selected plan after a confirm modal.
 * Both go through the daemon's `--control` write surface; a refusal (control
 * disabled, bad name, duplicate) displays in the modal as the daemon's reason.
 * A created plan appears in the picker on the next snapshot tick, when the
 * daemon re-reads the roster from disk; the console does not select it early,
 * because watching a plan the daemon has not discovered yet answers an error
 * frame. Renders nothing on a static page.
 *
 * @module @paw/gui/presentation/views/swarm/planActions
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { useState } from 'react';
import { usePlansClient } from '../../../application/context/consoleContext.js';
import { useConsoleActions } from '../../../application/hooks/useConsoleActions.js';
import { useSelectedPlan } from '../../../application/hooks/useConsole.js';
import { Button } from '../../atoms/button.js';
import { CloseLight } from '../../atoms/closeLight.js';
import { Modal } from '../../atoms/modal.js';

/**
 * Plan create and delete controls, with their modals.
 *
 * @returns {JSX.Element | null} Controls, or null on a static page.
 */
export function PlanActions() {
  const client = usePlansClient();
  const selected = useSelectedPlan();
  const { selectPlan } = useConsoleActions();
  const [dialog, setDialog] = useState<'create' | 'delete' | null>(null);
  const [name, setName] = useState('');
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (client === null) {
    return null;
  }

  const close = (): void => {
    setDialog(null);
    setName('');
    setReason(null);
    setBusy(false);
  };

  const create = (): void => {
    setBusy(true);
    setReason(null);
    void client.create(name.trim()).then((result) => {
      if (result.ok) {
        close();
        return;
      }
      setBusy(false);
      setReason(result.reason ?? 'refused');
    });
  };

  const remove = (): void => {
    if (selected === null) {
      return;
    }
    setBusy(true);
    setReason(null);
    void client.remove(selected).then((result) => {
      if (result.ok) {
        selectPlan(null);
        close();
        return;
      }
      setBusy(false);
      setReason(result.reason ?? 'refused');
    });
  };

  return (
    <span className='planactions'>
      <Button onClick={() => setDialog('create')}>new plan</Button>
      {selected !== null && (
        <CloseLight label='Delete plan' onClick={() => setDialog('delete')} />
      )}

      <Modal isOpen={dialog === 'create'} onClose={close} title='New swarm plan' size='sm'>
        <p className='sub'>
          scaffolds <code>plans/&lt;name&gt;.swarm.mjs</code> from the starter template
        </p>
        <input
          className='planname'
          aria-label='Plan name'
          placeholder='kebab-case-name'
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && name.trim() !== '' && !busy) {
              create();
            }
          }}
        />
        {reason !== null && <p className='ok crit'>{reason}</p>}
        <div className='modalrow'>
          <Button onClick={close}>cancel</Button>
          <Button primary disabled={name.trim() === '' || busy} onClick={create}>
            create
          </Button>
        </div>
      </Modal>

      <Modal isOpen={dialog === 'delete'} onClose={close} title='Delete plan' size='sm'>
        <p className='sub'>
          deletes <code>{selected}</code> from disk
        </p>
        {reason !== null && <p className='ok crit'>{reason}</p>}
        <div className='modalrow'>
          <Button onClick={close}>cancel</Button>
          <Button primary disabled={busy} onClick={remove}>
            delete
          </Button>
        </div>
      </Modal>
    </span>
  );
}
