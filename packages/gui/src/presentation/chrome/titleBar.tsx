/**
 * Title Bar
 *
 * @fileoverview The console's top edge, and it is two different things in two
 * shells. In the desktop shell the window is frameless and this **is** its
 * titlebar: the lights close, minimise, and maximise it for real, and the empty
 * space drags it. In a browser tab there is no window to control, so no lights
 * are drawn and nothing is draggable — a painted traffic light on a web page is
 * a costume with no buttons behind it. What both shells share is what is real
 * either way: the wordmark, the daemon pill read from the snapshot, and the
 * theme toggle.
 *
 * @module @paw/gui/presentation/chrome/titleBar
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { SunMoon } from 'lucide-react';
import { useShell } from '../../application/context/consoleContext.js';
import { useConsoleData } from '../../application/hooks/useConsole.js';
import { useTheme } from '../../application/hooks/useTheme.js';
import type { WindowControls } from '../../infrastructure/shell.js';
import { PawMark } from '../atoms/pawMark.js';

/**
 * The window's own controls — only rendered where they drive a real window.
 *
 * @param {{ controls: WindowControls }} props - The window controls.
 * @returns {JSX.Element} The lights.
 */
function Lights({ controls }: { readonly controls: WindowControls }) {
  return (
    <div className='lights'>
      <button type='button' className='light close' aria-label='Close window' onClick={controls.close} />
      <button
        type='button'
        className='light minimise'
        aria-label='Minimise window'
        onClick={controls.minimize}
      />
      <button
        type='button'
        className='light zoom'
        aria-label='Maximise window'
        onClick={controls.maximize}
      />
    </div>
  );
}

/**
 * The console's top bar.
 *
 * @returns {JSX.Element} The bar.
 */
export function TitleBar() {
  const { daemon } = useConsoleData();
  const { theme, toggle } = useTheme();
  const { controls } = useShell();

  return (
    <header>
      {controls !== null && <Lights controls={controls} />}
      <p className='wordmark'>
        <PawMark />
        <b>PAW</b>
      </p>
      <p className='daemon'>
        {daemon.live && <span className='pulse' aria-hidden='true' />}
        {`pawd ${daemon.live ? 'live' : 'idle'} · ${daemon.uptimeLabel} · pid ${daemon.pid}`}
      </p>
      <button
        type='button'
        className='theme-toggle'
        aria-label='Toggle colour theme'
        aria-pressed={theme === 'dark'}
        onClick={toggle}>
        <SunMoon size={13} aria-hidden='true' /> theme
      </button>
    </header>
  );
}
