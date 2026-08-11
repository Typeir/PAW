/**
 * Title Bar
 *
 * @fileoverview Console top edge. Desktop shell window frameless, this
 * titlebar renders lights that close, minimise, maximise the window and
 * empty-space drag. Browser tab has no window to control, so it renders no
 * lights and no drag region. Both shells render wordmark, daemon pill read
 * from snapshot, theme toggle.
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
 * Served repo short name for wordmark: last path segment of scope, so
 * `C:\Users\me\paw-test` read as `paw-test`.
 *
 * @param {string} root - Served repository path.
 * @returns {string} Name to show.
 */
export function scopeName(root: string): string {
  const trimmed = root.replace(/[\\/]+$/, '');
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return trimmed.slice(cut + 1);
}

/**
 * Window controls — rendered only when a window exists to control.
 *
 * @param {{ controls: WindowControls }} props - Window controls.
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
 * Console top bar.
 *
 * @returns {JSX.Element} The bar.
 */
export function TitleBar() {
  const { daemon, root } = useConsoleData();
  const { theme, toggle } = useTheme();
  const { controls } = useShell();

  return (
    <header>
      {controls !== null && <Lights controls={controls} />}
      <p className='wordmark'>
        <PawMark />
        <b>PAW</b>
        {root !== '' && (
          <span className='scope' title={root}>
            · {scopeName(root)}
          </span>
        )}
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
